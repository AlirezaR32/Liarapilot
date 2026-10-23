// GET /api/connections — what THIS workspace has connected (per-browser user).
// Tokens are user-provided via the UI; nothing comes from environment vars.
import { db } from '@/lib/db';
import { json, mapError, resolveUser } from '@/lib/api';
import { resolveTokenRef, maskSecret } from '@/lib/security/credentials';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await resolveUser();
    const [gh, gl, liara, ai, cfg] = await Promise.all([
      db.gitHubConnection.findUnique({ where: { userId: user.id } }),
      db.gitLabConnection.findUnique({ where: { userId: user.id } }),
      db.liaraConnection.findUnique({ where: { userId: user.id } }),
      db.aiConnection.findUnique({ where: { userId: user.id } }),
      db.appConfig.findUnique({ where: { id: 'app' } }),
    ]);

    return json({
      github: gh
        ? {
            login: gh.login,
            via: gh.via,
            verified: gh.verified,
            tokenMask: maskSecret(resolveTokenRef(gh.tokenRef) ?? ''),
            connectedAt: gh.createdAt,
          }
        : null,
      gitlab: gl
        ? {
            login: gl.login,
            via: gl.via,
            verified: gl.verified,
            instanceUrl: gl.instanceUrl,
            tokenMask: maskSecret(resolveTokenRef(gl.tokenRef) ?? ''),
            connectedAt: gl.createdAt,
          }
        : null,
      liara: liara
        ? {
            verified: liara.verified,
            accountEmail: liara.accountEmail,
            tokenMask: maskSecret(resolveTokenRef(liara.tokenRef) ?? ''),
            connectedAt: liara.createdAt,
          }
        : null,
      ai: ai
        ? {
            provider: ai.provider,
            model: ai.model,
            baseUrl: ai.baseUrl,
            keyMask: maskSecret(resolveTokenRef(ai.apiKeyRef) ?? ''),
            connectedAt: ai.createdAt,
          }
        : null,
      appConfig: {
        githubDevice: Boolean(cfg?.githubClientId),
        gitlabDevice: Boolean(cfg?.gitlabClientId),
      },
    });
  } catch (e) {
    return mapError(e);
  }
}
