import { db } from '@/lib/db';
import { resolveUser, json, mapError, requireProject } from '@/lib/api';
import { createRun } from '@/lib/workers/runner';
import { enqueue, processJobs } from '@/lib/workers/queue';
import { audit } from '@/lib/services/audit';
import { policyFor } from '@/lib/agent/policies';

export const dynamic = 'force-dynamic';

/** Workflow detail: run + events (progress visibility, spec §11). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    const run = await db.workflowRun.findUnique({ where: { id } });
    if (!run) return json({ error: 'run not found' }, 404);
    if (run.projectId) await requireProject(run.projectId, user.id);
    else if (run.userId !== user.id) return json({ error: 'access denied' }, 403);

    const events = await db.workflowEvent.findMany({ where: { runId: run.id }, orderBy: { id: 'asc' }, take: 200 });
    return json({
      run: {
        id: run.id,
        kind: run.kind,
        trigger: run.trigger,
        status: run.status,
        stage: run.stage,
        projectId: run.projectId,
        report: run.reportJson ? JSON.parse(run.reportJson) : null,
        error: run.error,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
      },
      events: events.map((e) => ({ id: e.id.toString(), node: e.node, level: e.level, message: e.message, data: e.dataJson ? JSON.parse(e.dataJson) : null, at: e.createdAt })),
    });
  } catch (e) {
    return mapError(e);
  }
}

/** Re-drive an investigation or re-request approval expiry cleanup. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    const run = await db.workflowRun.findUnique({ where: { id } });
    if (!run || run.userId !== user.id) return json({ error: 'run not found' }, 404);
    // A completed incident investigation can be re-run via the incident endpoint.
    return json({ ok: true, status: run.status });
  } catch (e) {
    return mapError(e);
  }
}

/** List runs for a project (query: ?projectId=). */
export async function PUT(req: Request) {
  try {
    const user = await resolveUser();
    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId') ?? '';
    const project = await requireProject(projectId, user.id);
    const runs = await db.workflowRun.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const policy = policyFor(project.monitorPolicy);
    await audit('runs.listed', { userId: user.id, projectId: project.id, actor: 'user' });
    return json({ runs: runs.map((r) => ({ id: r.id, kind: r.kind, status: r.status, stage: r.stage, trigger: r.trigger, createdAt: r.createdAt })), policy });
  } catch (e) {
    return mapError(e);
  }
}
