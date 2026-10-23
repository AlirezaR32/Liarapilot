import { db } from '@/lib/db';
import { resolveUser, json, mapError, requireProject } from '@/lib/api';
import { createRun } from '@/lib/workers/runner';
import { enqueue, processJobs } from '@/lib/workers/queue';
import { redactValue } from '@/lib/security/redaction';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    const incident = await db.incident.findUnique({ where: { id }, include: { project: true } });
    if (!incident) return json({ error: 'incident not found' }, 404);
    await requireProject(incident.projectId, user.id); // tenant check

    const run = incident.runId ? await db.workflowRun.findUnique({ where: { id: incident.runId } }) : null;
    const events = run ? await db.workflowEvent.findMany({ where: { runId: run.id }, orderBy: { id: 'asc' }, take: 100 }) : [];

    return json({
      incident: {
        id: incident.id,
        kind: incident.kind,
        status: incident.status,
        title: incident.title,
        summary: incident.summary,
        evidence: incident.evidenceJson ? redactValue(JSON.parse(incident.evidenceJson)) : null,
        diagnosis: incident.diagnosisJson ? redactValue(JSON.parse(incident.diagnosisJson)) : null,
        remediation: incident.remediationJson ? redactValue(JSON.parse(incident.remediationJson)) : null,
        firstSeenAt: incident.firstSeenAt,
        lastSeenAt: incident.lastSeenAt,
        resolvedAt: incident.resolvedAt,
        runId: incident.runId,
        projectName: incident.project.name,
        projectId: incident.projectId,
      },
      events: events.map((e) => ({ id: e.id.toString(), node: e.node, level: e.level, message: e.message, at: e.createdAt })),
    });
  } catch (e) {
    return mapError(e);
  }
}

/** Manual (re-)investigation of an incident. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    const incident = await db.incident.findUnique({ where: { id } });
    if (!incident) return json({ error: 'incident not found' }, 404);
    const project = await requireProject(incident.projectId, user.id);

    const { runId } = await createRun({
      projectId: project.id,
      userId: user.id,
      kind: 'incident_investigation',
      trigger: 'incident',
      input: { incidentId: incident.id },
    });
    await db.incident.update({ where: { id: incident.id }, data: { status: 'investigating', runId } });
    await enqueue('run_workflow', { runId }, { priority: 2 });
    void processJobs(1);
    return json({ runId }, 202);
  } catch (e) {
    return mapError(e);
  }
}
