// POST   /api/connections/github  { token }        — validate + store a PAT
// DELETE /api/connections/github                     — disconnect
import { db } from '@/lib/db';
import { json, mapError, readJson, resolveUser } from '@/lib/api';
import { makeEncryptedRef } from '@/lib/security/credentials';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

class TokenInvalidError extends Error {}

async function validateGithubToken(token: string): Promise<{ login: string; scopes: string[] }> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LiaraPilot/0.1',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new TokenInvalidError('token rejected by GitHub (invalid or expired)');
  if (res.status === 403) throw new TokenInvalidError('token rejected by GitHub (rate limit or missing scope)');
  if (!res.ok) throw new TokenInvalidError(`GitHub validation failed (${res.status})`);
  const j = (await res.json()) as { login?: string };
  const scopes = (res.headers.get('x-oauth-scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { login: j.login ?? 'unknown', scopes };
}

export async function POST(req: Request) {
  try {
    const user = await resolveUser();
    const body = await readJson<{ token?: string }>(req);
    const token = (body.token ?? '').trim();
    if (!token || token.length < 20) return json({ error: 'a valid GitHub token is required' }, 400);

    const { login, scopes } = await validateGithubToken(token);
    await db.gitHubConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        tokenRef: makeEncryptedRef(token),
        login,
        scopes: JSON.stringify(scopes),
        via: 'pat',
        verified: true,
        verifiedAt: new Date(),
      },
      update: {
        tokenRef: makeEncryptedRef(token),
        login,
        scopes: JSON.stringify(scopes),
        via: 'pat',
        verified: true,
        verifiedAt: new Date(),
      },
    });
    await audit('connection.github.pat', { userId: user.id, actor: 'user', detail: { login } });
    return json({ ok: true, login, scopes });
  } catch (e) {
    if (e instanceof TokenInvalidError) return json({ error: e.message }, 400);
    return mapError(e);
  }
}

export async function DELETE() {
  try {
    const user = await resolveUser();
    await db.gitHubConnection.deleteMany({ where: { userId: user.id } });
    await audit('connection.github.disconnect', { userId: user.id, actor: 'user' });
    return json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
