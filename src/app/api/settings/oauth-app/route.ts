// GET /api/settings/oauth-app — whether browser (Device Flow) login is set up
// for this deployment, plus the PUBLIC client IDs (safe to show).
// PUT /api/settings/oauth-app { githubClientId?, gitlabClientId?, gitlabClientSecret?, gitlabInstanceUrl? }
// — one-time configuration by the deployment owner, stored in DB (NOT env).
import { db } from '@/lib/db';
import { json, mapError, readJson, resolveUser } from '@/lib/api';
import { makeEncryptedRef } from '@/lib/security/credentials';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await resolveUser();
    const cfg = await db.appConfig.findUnique({ where: { id: 'app' } });
    return json({
      githubClientId: cfg?.githubClientId ?? null,
      gitlabClientId: cfg?.gitlabClientId ?? null,
      gitlabInstanceUrl: cfg?.gitlabInstanceUrl ?? 'https://gitlab.com',
      hasGitlabSecret: Boolean(cfg?.gitlabClientSecretRef),
      updatedAt: cfg?.updatedAt ?? null,
    });
  } catch (e) {
    return mapError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await resolveUser();
    const body = await readJson<{ githubClientId?: string; gitlabClientId?: string; gitlabClientSecret?: string; gitlabInstanceUrl?: string }>(req);

    const data: Record<string, unknown> = {};
    if (body.githubClientId !== undefined) data.githubClientId = body.githubClientId.trim() || null;
    if (body.gitlabClientId !== undefined) data.gitlabClientId = body.gitlabClientId.trim() || null;
    if (body.gitlabInstanceUrl !== undefined) {
      const u = body.gitlabInstanceUrl.trim() || 'https://gitlab.com';
      data.gitlabInstanceUrl = /^https?:\/\//.test(u) ? u.replace(/\/+$/, '') : `https://${u.replace(/\/+$/, '')}`;
    }
    if (body.gitlabClientSecret) data.gitlabClientSecretRef = makeEncryptedRef(body.gitlabClientSecret.trim());

    await db.appConfig.upsert({
      where: { id: 'app' },
      create: { id: 'app', ...data },
      update: data,
    });
    await audit('settings.oauth_app.saved', { userId: user.id, actor: 'user' });
    return json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
