// Repo source archive: download the USER'S repository snapshot (tar.gz at a
// specific revision) with the user's OWN connected token, extract it to a
// per-workspace directory on the data disk, and return the extracted source
// root. This is what makes "deploy MY repo" real — liara deploy runs against
// THIS directory, never against LiaraPilot's own installation.
//
// Bounds (spec §12): size cap, time-boxed download/extract, bounded disk usage
// (old archives of the same repo are pruned), no shell interpolation.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';

const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024; // 300 MB hard cap
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const EXTRACT_TIMEOUT_MS = 2 * 60 * 1000;
const KEEP_ARCHIVES_PER_REPO = 2;

export class RepoArchiveError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

function dataDir(): string {
  const url = process.env.DATABASE_URL ?? '';
  const m = /^file:(.*)$/.exec(url);
  if (m && m[1]) return path.dirname(m[1]);
  return path.join(process.cwd(), 'db');
}

function ref7(ref: string | null | undefined): string {
  const r = (ref ?? 'head').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 12);
  return r || 'head';
}

function sanitize(seg: string): string {
  return seg.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60) || 'repo';
}

export function workspaceReposRoot(userId: string): string {
  const ws = sanitize(userId);
  return path.join(dataDir(), 'repos', ws);
}

/** Deterministic extraction root for (userId, repo, ref) — used for display in
 *  approval payloads before the archive is actually downloaded. */
export function expectedSourceRoot(userId: string, repo: string, ref: string | null): string {
  return path.join(workspaceReposRoot(userId), `${sanitize(repo)}-${ref7(ref)}`);
}

/** Download the repo tarball and extract it. Returns the extracted source root. */
export async function prepareRepoSource(opts: {
  userId: string;
  provider: 'github' | 'gitlab';
  owner: string;
  repo: string;
  ref: string | null; // commit sha preferred, else branch
  token: string | null;
  instanceUrl: string | null;
  onProgress?: (message: string) => Promise<void> | void;
}): Promise<{ dir: string; bytes: number }> {
  const { userId, provider, owner, repo, ref, token } = opts;
  const root = path.join(workspaceReposRoot(userId), `${sanitize(repo)}-${ref7(ref)}`);

  // already prepared (retry path) — reuse
  if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
    return { dir: sourceRoot(root), bytes: dirSize(root) };
  }
  fs.mkdirSync(root, { recursive: true });

  const url =
    provider === 'github'
      ? `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(ref ?? '')}`
      : `${(opts.instanceUrl ?? 'https://gitlab.com').replace(/\/+$/, '')}/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/archive.tar.gz?sha=${encodeURIComponent(ref ?? '')}`;

  const headers: Record<string, string> = { 'User-Agent': 'LiaraPilot/0.1 (repo deployer)' };
  if (token) headers.Authorization = `Bearer ${token}`;

  await opts.onProgress?.(`در حال دانلود سورس‌کد از ${provider} (revision ${ref7(ref)})…`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  let bytes = 0;
  const tgzPath = `${root}.tar.gz`;
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
    if (res.status === 404) {
      throw new RepoArchiveError('دانلود سورس ناموفق بود: مخزن یا revision پیدا نشد (۴۰۴) — دسترسی توکن را بررسی کنید', 404);
    }
    if (res.status === 403) {
      throw new RepoArchiveError('دانلود سورس ناموفق بود: دسترسی مجاز نیست (۴۰۳) — توکن باید به مخزن دسترسی داشته باشد', 403);
    }
    if (!res.ok || !res.body) {
      throw new RepoArchiveError(`دانلود سورس ناموفق بود (HTTP ${res.status})`, res.status);
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_ARCHIVE_BYTES) {
      throw new RepoArchiveError(`حجم مخزن (${Math.round(len / 1048576)}MB) از سقف مجاز ۳۰۰MB بیشتر است`);
    }

    // stream to disk with a hard byte cap (independent of content-length)
    let aborted = false;
    const capStream = new Readable({ read() {} });
    const reader = res.body.getReader();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_ARCHIVE_BYTES) {
            aborted = true;
            capStream.destroy(new RepoArchiveError('حجم آرشیو مخزن از سقف مجاز ۳۰۰MB گذشت'));
            ctrl.abort();
            return;
          }
          if (!capStream.push(Buffer.from(value))) await new Promise<void>((r) => capStream.once('drain', () => r()));
        }
        capStream.push(null);
      } catch (e) {
        capStream.destroy(e instanceof Error ? e : new Error(String(e)));
      }
    })();

    await pipeline(capStream, createWriteStream(tgzPath));
    if (aborted) throw new RepoArchiveError('حجم آرشیو مخزن از سقف مجاز ۳۰۰MB گذشت');

    await opts.onProgress?.(`دانلود کامل شد (${(bytes / 1048576).toFixed(1)}MB) — در حال استخراج…`);
    await extractTar(tgzPath, root);

    if (fs.readdirSync(root).length === 0) {
      throw new RepoArchiveError('آرشیو مخزن خالی بود — استخراج نتیجه‌ای نداشت');
    }
    await opts.onProgress?.('سورس‌کد آماده شد');
    pruneOldArchives(root, KEEP_ARCHIVES_PER_REPO);
    return { dir: sourceRoot(root), bytes };
  } catch (e) {
    // best-effort cleanup of the failed attempt
    try {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(tgzPath, { force: true });
    } catch { /* ignore */ }
    if (e instanceof RepoArchiveError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new RepoArchiveError(/abort|timeout/i.test(msg) ? 'دانلود سورس بیش از حد طول کشید (timeout)' : `دانلود/استخراج سورس ناموفق بود: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** GitHub/GitLab tarballs contain a single top-level dir — deploy from inside it. */
function sourceRoot(extractedDir: string): string {
  try {
    const entries = fs.readdirSync(extractedDir, { withFileTypes: true });
    if (entries.length === 1 && entries[0].isDirectory()) {
      return path.join(extractedDir, entries[0].name);
    }
  } catch { /* fall through */ }
  return extractedDir;
}

function extractTar(tgzPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', tgzPath, '-C', destDir], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, EXTRACT_TIMEOUT_MS);
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new RepoArchiveError(`استخراج آرشیو ناموفق بود: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new RepoArchiveError(`استخراج آرشیو ناموفق بود (exit ${code}): ${stderr.slice(-300)}`));
    });
  });
}

function dirSize(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      const p = path.join(cur, it.name);
      try {
        if (it.isDirectory()) stack.push(p);
        else total += fs.statSync(p).size;
      } catch { /* ignore */ }
    }
  }
  return total;
}

/** Keep only the newest N archives per repo (per workspace) — bounded disk. */
function pruneOldArchives(currentRoot: string, keep: number): void {
  const repoDir = path.dirname(currentRoot);
  const prefix = `${path.basename(currentRoot).split('-')[0]}-`;
  try {
    const dirs = fs
      .readdirSync(repoDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(repoDir, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    let kept = 0;
    for (const d of dirs) {
      if (!d.name.startsWith(prefix)) continue;
      kept += 1;
      if (kept > keep) fs.rmSync(path.join(repoDir, d.name), { recursive: true, force: true });
    }
  } catch { /* best effort */ }
}
