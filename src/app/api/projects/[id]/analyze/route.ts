import { resolveUser, json, mapError, requireProject } from '@/lib/api';
import { createRun } from '@/lib/workers/runner';
import { enqueue, processJobs } from '@/lib/workers/queue';
import { getProfileCached } from '@/lib/services/projects';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

/** Force a fresh repository analysis (bypasses the revision cache). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    const project = await requireProject(id, user.id);

    await audit('analysis.requested', { userId: user.id, projectId: project.id, actor: 'user' });

    // deterministic path: run analyzer directly, no LLM, no graph needed
    const { profile, fromCache } = await getProfileCached(project, { force: true });
    return json({ profile, fromCache });
  } catch (e) {
    return mapError(e);
  }
}

/** Manual deploy request → full pipeline with approval gate (spec §7). */
export async function PUT(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    const project = await requireProject(id, user.id);
    const { runId } = await createRun({ projectId: project.id, userId: user.id, kind: 'deploy_pipeline', trigger: 'manual_deploy' });
    await enqueue('run_workflow', { runId }, { priority: 2 });
    void processJobs(1); // kick the worker
    return json({ runId }, 202);
  } catch (e) {
    return mapError(e);
  }
}
