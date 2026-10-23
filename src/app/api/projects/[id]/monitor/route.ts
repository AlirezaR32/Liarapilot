// PUT /api/projects/:id/monitor — monitoring policy + toggle for a project.
import { db } from '@/lib/db';
import { resolveUser, json, mapError, readJson, requireProject } from '@/lib/api';
import { audit } from '@/lib/services/audit';
import { checkIntervalFor } from '@/lib/agent/policies';

export const dynamic = 'force-dynamic';

interface MonitorBody {
  monitorPolicy?: 'low_cost' | 'balanced' | 'fast';
  monitorEnabled?: boolean;
  healthUrl?: string | null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    await requireProject(id, user.id);
    const body = await readJson<MonitorBody>(req);

    const data: Record<string, unknown> = {};
    if (body.monitorPolicy && ['low_cost', 'balanced', 'fast'].includes(body.monitorPolicy)) {
      data.monitorPolicy = body.monitorPolicy;
      data.checkIntervalS = checkIntervalFor(body.monitorPolicy);
    }
    if (typeof body.monitorEnabled === 'boolean') data.monitorEnabled = body.monitorEnabled;
    if (body.healthUrl !== undefined) {
      const u = (body.healthUrl ?? '').trim();
      if (u && !/^https?:\/\//.test(u)) return json({ error: 'health URL must start with http(s)://' }, 400);
      data.healthUrl = u || null;
    }

    await db.project.update({ where: { id }, data });
    await audit('project.monitor_updated', { userId: user.id, projectId: id, actor: 'user', detail: data });
    return json({ ok: true });
  } catch (e) {
    return mapError(e);
  }
}
