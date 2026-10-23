// Credential resolution: LiaraPilot never passes secret VALUES through graph
// state, prompts, logs, or the frontend. Nodes only carry REFERENCES
// ("conn:<id>"); this module resolves references at the last possible moment,
// inside the integration layer.
//
// Commercial model (no env credentials): every token comes from the user via
// the Settings UI and is stored AES-256-GCM encrypted at rest. The encryption
// key itself is auto-generated on first boot and persisted on the data disk
// (next to the SQLite file) — zero environment configuration required.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';

let cachedKey: Buffer | null = null;

function dataDir(): string {
  const url = process.env.DATABASE_URL ?? '';
  const m = /^file:(.*)$/.exec(url);
  if (m && m[1]) return path.dirname(m[1]);
  return path.join(process.cwd(), 'db');
}

/**
 * App secret for AES-256-GCM. Optional LIARAPILOT_SECRET env wins (advanced
 * deployments); otherwise a random 256-bit key is generated once and stored
 * on the persistent data disk so encrypted tokens survive restarts.
 */
function appSecret(): Buffer {
  if (cachedKey) return cachedKey;
  const envSecret = process.env.LIARAPILOT_SECRET;
  if (envSecret && envSecret.length >= 16) {
    cachedKey = createHash('sha256').update(envSecret).digest();
    return cachedKey;
  }
  const file = path.join(dataDir(), 'liarapilot.secret.key');
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      cachedKey = Buffer.from(raw, 'hex');
      return cachedKey;
    }
  } catch {
    /* first boot */
  }
  const raw = randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(file, `${raw}\n`, { mode: 0o600 });
  cachedKey = Buffer.from(raw, 'hex');
  return cachedKey;
}

/** Encrypt a secret for at-rest storage (AES-256-GCM). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', appSecret(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(blob: string): string | null {
  try {
    const [v, ivB64, tagB64, dataB64] = blob.split(':');
    if (v !== 'v1') return null;
    const decipher = createDecipheriv('aes-256-gcm', appSecret(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Resolve a credential reference to its value. Returns null when unavailable. */
export function resolveTokenRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('enc:')) return decryptSecret(ref.slice(4));
  return null;
}

/**
 * Per-workspace git provider token — the user's OWN connection (PAT entered
 * in the UI, or browser Device-Flow OAuth). NO env fallback: everyone connects
 * their own account. Returns null when not connected (public repos still work
 * for GitHub).
 */
export async function gitConnectionToken(
  userId: string,
  provider: 'github' | 'gitlab',
): Promise<{ token: string | null; instanceUrl: string | null }> {
  try {
    if (provider === 'github') {
      const conn = await db.gitHubConnection.findUnique({ where: { userId } });
      if (conn) return { token: resolveTokenRef(conn.tokenRef), instanceUrl: null };
    } else {
      const conn = await db.gitLabConnection.findUnique({ where: { userId } });
      if (conn) return { token: resolveTokenRef(conn.tokenRef), instanceUrl: conn.instanceUrl };
    }
  } catch {
    /* db unavailable — treat as not connected */
  }
  return { token: null, instanceUrl: provider === 'gitlab' ? 'https://gitlab.com' : null };
}

/**
 * Per-workspace Liara API token — entered by the user in the UI (from Liara
 * Console → API Keys). Resolved at the last possible moment, never cached in
 * graph state or logs.
 */
export async function liaraConnectionToken(userId: string): Promise<string | null> {
  try {
    const conn = await db.liaraConnection.findUnique({ where: { userId } });
    if (!conn) return null;
    return resolveTokenRef(conn.tokenRef);
  } catch {
    return null;
  }
}

/** Never log or persist these — helpers to guarantee refs are what we store. */
export function makeEncryptedRef(secret: string): string {
  return `enc:${encryptSecret(secret)}`;
}

export function maskSecret(secret: string): string {
  if (secret.length <= 6) return '******';
  return `${secret.slice(0, 3)}…${secret.slice(-2)}`;
}
