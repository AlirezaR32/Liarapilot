// POST /api/connections/device/github/poll { sessionId } — one poll tick.
// The client calls this on the provider's interval until status becomes
// done / denied / expired. On success the provider identity is fetched and
// the connection is stored for THIS workspace (token AES-256-GCM encrypted).
import { db } from '@/lib/db';
import { json, mapError, readJson, resolveUser } from '@/lib/api';
import { makeEncryptedRef } from '@/lib/security/credentials';
import { deleteSession, getSession, isDeviceProvider, pollDeviceToken } from '@/lib/integrations/oauth/deviceFlow';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const user = await resolveUser();
    const { provider } = await params;
    if (!isDeviceProvider(provider)) return json({ error: 'unknown provider' }, 404);

    const body = await readJson<{ sessionId?: string }>(req);
    const session = body.sessionId ? getSession(body.sessionId) : undefined;
    if (!session || session.provider !== provider) return json({ status: 'expired' });

    const cfg = await db.appConfig.findUnique({ where: { id: 'app' } });
    const clientId = provider === 'github' ? cfg?.githubClientId : cfg?.gitlabClientId;
    const clientSecret = provider === 'gitlab' && cfg?.gitlabClientSecretRef ? await import('@/lib/security/credentials').then((m) => m.resolveTokenRef(cfg.gitlabClientSecretRef)) : null;
    if (!clientId) return json({ status: 'expired' });

    const result = await pollDeviceToken(provider, session.deviceCode, clientId, clientSecret, cfg?.gitlabInstanceUrl ?? 'https://gitlab.com');

    if (result.status === 'pending' || result.status === 'slow_down') return json({ status: 'pending' });
    if (result.status === 'denied') {
      deleteSession(session.id);
      return json({ status: 'denied' });
    }
    if (result.status === 'expired') {
      deleteSession(session.id);
      return json({ status: 'expired' });
    }

    // done — fetch identity and store the connection
    const token = result.accessToken;
    let login = 'unknown';
    let accountId = 'unknown';
    let avatarUrl: string | null = null;
    let scopes: string[] = [];

    if (provider === 'github') {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'LiaraPilot/0.1' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return json({ status: 'error', error: `identity fetch failed (${res.status})` });
      const j = (await res.json()) as { login?: string; id?: number; avatar_url?: string };
      login = j.login ?? 'unknown';
      accountId = String(j.id ?? login);
      avatarUrl = j.avatar_url ?? null;
      const scopeHeader = res.headers.get('x-oauth-scopes') ?? '';
      scopes = scopeHeader.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      const base = cfg?.gitlabInstanceUrl ?? 'https://gitlab.com';
      const res = await fetch(`${base.replace(/\/+$/, '')}/api/v4/user`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return json({ status: 'error', error: `identity fetch failed (${res.status})` });
      const j = (await res.json()) as { username?: string; id?: number; avatar_url?: string };
      login = j.username ?? 'unknown';
      accountId = String(j.id ?? login);
      avatarUrl = j.avatar_url ?? null;
      scopes = ['read_api'];
    }

    if (provider === 'github') {
      await db.gitHubConnection.upsert({
        where: { userId: user.id },
        create: { userId: user.id, tokenRef: makeEncryptedRef(token), login, scopes: JSON.stringify(scopes), via: 'oauth', verified: true, verifiedAt: new Date() },
        update: { tokenRef: makeEncryptedRef(token), login, scopes: JSON.stringify(scopes), via: 'oauth', verified: true, verifiedAt: new Date() },
      });
    } else {
      const instanceUrl = cfg?.gitlabInstanceUrl ?? 'https://gitlab.com';
      await db.gitLabConnection.upsert({
        where: { userId: user.id },
        create: { userId: user.id, tokenRef: makeEncryptedRef(token), instanceUrl, login, via: 'oauth', verified: true, verifiedAt: new Date() },
        update: { tokenRef: makeEncryptedRef(token), instanceUrl, login, via: 'oauth', verified: true, verifiedAt: new Date() },
      });
    }

    await db.oAuthAccount.upsert({
      where: { provider_providerAccountId: { provider, providerAccountId: accountId } },
      create: { userId: user.id, provider, providerAccountId: accountId, username: login, avatarUrl, accessTokenRef: makeEncryptedRef(token), scope: scopes.join(',') },
      update: { userId: user.id, username: login, avatarUrl, accessTokenRef: makeEncryptedRef(token), scope: scopes.join(',') },
    });

    deleteSession(session.id);
    await audit(`connection.${provider}.device_done`, { userId: user.id, actor: 'user', detail: { login, via: 'oauth' } });
    return json({ status: 'done', login });
  } catch (e) {
    return mapError(e);
  }
}
