// POST   /api/connections/gitlab  { token, instanceUrl? } — validate + store PAT
// DELETE /api/connections/gitlab                           — disconnect
import { db } from '@/lib/db';
import { json, mapError, readJson, resolveUser } from '@/lib/api';
import { makeEncryptedRef } from '@/lib/security/credentials';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

class TokenInvalidError extends Error {}

function normalizeInstance(raw?: string): string {
  const url = (raw && raw.trim()) || 'https://gitlab.com';
  return /^https?:\/\//.test(url) ? url.replace(/\/+$/, '') : `https://${url.replace(/\/+$/, '')}`;
}

async function validateGitlabToken(token: string, instanceUrl: string): Promise<{ login: string; name: string | null }> {
  const res = await fetch(`${instanceUrl}/api/v4/user`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new TokenInvalidError('token rejected by GitLab (invalid or expired)');
  if (res.status === 403) throw new TokenInvalidError('token rejected by GitLab (insufficient scope — needs read_api/api)');
  if (!res.ok) throw new TokenInvalidError(`GitLab validation failed (${res.status})`);
  const j = (await res.json()) as { username?: string; name?: string };
  return { login: j.username ?? 'unknown', name: j.name ?? null };
}

export async function POST(req: Request) {
  try {
    const user = await resolveUser();
    const body = await readJson<{ token?: string; instanceUrl?: string }>(req);
    const token = (body.token ?? '').trim();
    const instanceUrl = normalizeInstance(body.instanceUrl);
    if (!token || token.length < 16) return json({ error: 'a valid GitLab personal access token is required' }, 400);

    const { login } = await validateGitlabToken(token, instanceUrl);
    await db.gitLabConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        tokenRef: makeEncryptedRef(token),
        instanceUrl,
        login,
        via: 'pat',
        verified: true,
        verifiedAt: new Date(),
      },
      update: {
        tokenRef: makeEncryptedRef(token),
        instanceUrl,
        login,
        via: 'pat',
        verified: true,
        verifiedAt: new Date(),
      },
    });
    await audit('connection.gitlab.pat', { userId: user.id, actor: 'user', detail: { login, instanceUrl } });
    return json({ ok: true, login, instanceUrl });
  } catch (e) {
    if (e instanceof TokenInvalidError) return json({ error: e.message }, 400);
    return mapError(e);
  }
}

export async function DELETE() {
  try {
    const user = await resolveUser();
    await db.gitLabConnection.deleteMany({ where: { userId: user.id } });
    await audit('connection.gitlab.disconnect', { userId: user.id, actor: 'user' });
    return json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
