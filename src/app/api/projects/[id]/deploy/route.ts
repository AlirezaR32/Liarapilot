import { resolveUser, json, mapError, requireProject } from '@/lib/api';
import { createRun } from '@/lib/workers/runner';
import { enqueue, processJobs } from '@/lib/workers/queue';
import { audit } from '@/lib/services/audit';
import { liaraConnectionToken } from '@/lib/security/credentials';

export const dynamic = 'force-dynamic';

/** Manual deploy request → full pipeline with approval gate (spec §7). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    const project = await requireProject(id, user.id);

    // Commercial gate: deploys are REAL operations — require the user's own Liara connection.
    const hasLiara = Boolean(await liaraConnectionToken(user.id));
    if (!hasLiara) {
      return json({ error: 'اتصال لیارا برقرار نیست — ابتدا توکن API لیارا را در «تنظیمات ← اتصال لیارا» وارد کنید.', code: 'liara_not_connected' }, 400);
    }

    await audit('deploy.requested', { userId: user.id, projectId: project.id, actor: 'user' });
    const { runId } = await createRun({ projectId: project.id, userId: user.id, kind: 'deploy_pipeline', trigger: 'manual_deploy' });
    await enqueue('run_workflow', { runId }, { priority: 2 });
    void processJobs(1);
    return json({ runId }, 202);
  } catch (e) {
    return mapError(e);
  }
}
