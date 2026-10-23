// DB-backed job queue + in-process worker + scheduler (spec §4: "Choose a
// lightweight, maintainable queue solution... Do not introduce Redis").
// Jobs are persisted so restarts don't lose pending work.

import { db } from '@/lib/db';
import { executeRun } from './runner';
import { monitorSweep } from '@/lib/services/monitoring';
import { expireStaleApprovals } from '@/lib/services/approvals';

interface JobPayload {
  runId?: string;
  projectId?: string;
  incidentId?: string;
  decision?: { approved: boolean; decidedBy: string; note?: string };
  jobId?: string;
}

export async function enqueue(
  kind: string,
  payload: JobPayload,
  opts: { priority?: number; dedupeKey?: string | null; delayMs?: number } = {},
): Promise<string | null> {
  const runAt = new Date(Date.now() + (opts.delayMs ?? 0));
  if (opts.dedupeKey) {
    const existing = await db.job.findFirst({
      where: { dedupeKey: opts.dedupeKey, status: { in: ['queued', 'running'] } },
    });
    if (existing) return null; // deduped
  }
  const job = await db.job.create({
    data: { kind, payloadJson: JSON.stringify(payload), priority: opts.priority ?? 5, runAt, dedupeKey: opts.dedupeKey ?? null },
  });
  return job.id;
}

type Handler = (payload: JobPayload, jobId: string) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  async run_workflow(payload) {
    if (!payload.runId) throw new Error('run_workflow requires runId');
    await executeRun(payload.runId);
  },
  async resume_workflow(payload) {
    if (!payload.runId) throw new Error('resume_workflow requires runId');
    if (!payload.decision) throw new Error('resume_workflow requires decision');
    await executeRun(payload.runId, payload.decision);
  },
  async monitor_sweep() {
    const { checked, newIncidents } = await monitorSweep(new Date());
    for (const incidentId of newIncidents) {
      await triggerInvestigation(incidentId);
    }
    void checked;
  },
  async expire_approvals() {
    await expireStaleApprovals();
  },
  async investigate_incident(payload) {
    const incident = payload.incidentId ? await db.incident.findUnique({ where: { id: payload.incidentId } }) : null;
    if (!incident) return;
    const project = await db.project.findUnique({ where: { id: incident.projectId } });
    if (!project) return;
    const { createRun } = await import('./runner');
    const { runId } = await createRun({
      projectId: project.id,
      userId: project.userId,
      kind: 'incident_investigation',
      trigger: 'incident',
      input: { incidentId: incident.id },
    });
    await db.incident.update({ where: { id: incident.id }, data: { status: 'investigating', runId } });
    await enqueue('run_workflow', { runId }, { priority: 3 });
  },
};

// ---------------------------------------------------------------------------
// Shared: open an investigation for an incident (used by sweep + demo seed)
// ---------------------------------------------------------------------------

export async function triggerInvestigation(incidentId: string): Promise<string | null> {
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident) return null;
  const project = await db.project.findUnique({ where: { id: incident.projectId } });
  if (!project) return null;
  const { createRun } = await import('./runner');
  const { runId } = await createRun({
    projectId: project.id,
    userId: project.userId,
    kind: 'incident_investigation',
    trigger: 'incident',
    input: { incidentId },
  });
  await db.incident.update({ where: { id: incidentId }, data: { status: 'investigating', runId } });
  await enqueue('run_workflow', { runId }, { priority: 3, dedupeKey: `investigate:${incidentId}` });
  return runId;
}

// ---------------------------------------------------------------------------
let running = false;

export async function processJobs(maxJobs = 5): Promise<number> {
  if (running) return 0;
  running = true;
  let processed = 0;
  try {
    for (let i = 0; i < maxJobs; i++) {
      // optimistic claim (SQLite-safe)
      const candidates = await db.job.findMany({
        where: { status: 'queued', runAt: { lte: new Date() } },
        orderBy: [{ priority: 'asc' }, { runAt: 'asc' }],
        take: 1,
      });
      const candidate = candidates[0];
      if (!candidate) break;
      const claimed = await db.job.updateMany({
        where: { id: candidate.id, status: 'queued' },
        data: { status: 'running', startedAt: new Date() },
      });
      if (claimed.count === 0) continue;

      const handler = HANDLERS[candidate.kind];
      try {
        if (!handler) throw new Error(`no handler for job kind ${candidate.kind}`);
        const payload = JSON.parse(candidate.payloadJson) as JobPayload;
        await handler({ ...payload, jobId: candidate.id }, candidate.id);
        await db.job.update({ where: { id: candidate.id }, data: { status: 'succeeded', finishedAt: new Date() } });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const attempts = candidate.attempts + 1;
        const retryable = attempts < candidate.maxAttempts;
        await db.job.update({
          where: { id: candidate.id },
          data: {
            status: retryable ? 'queued' : 'failed',
            attempts,
            lastError: msg.slice(0, 800),
            runAt: retryable ? new Date(Date.now() + 2000 * attempts) : undefined,
            finishedAt: retryable ? undefined : new Date(),
          },
        });
      }
      processed++;
    }
  } finally {
    running = false;
  }
  return processed;
}

// ---------------------------------------------------------------------------
// Scheduler: lightweight periodic triggers
// ---------------------------------------------------------------------------

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let ticks = 0;

export function startScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    ticks++;
    void (async () => {
      try {
        // monitor sweep every 15s (deduped by the queue)
        await enqueue('monitor_sweep', {}, { priority: 7, dedupeKey: `monitor_sweep:${Math.floor(Date.now() / 15000)}` });
        // expire approvals every ~5 min
        if (ticks % 20 === 0) {
          await enqueue('expire_approvals', {}, { priority: 8, dedupeKey: `expire:${Math.floor(Date.now() / 300000)}` });
        }
        await processJobs(3);
      } catch (e) {
        console.error('[scheduler]', e instanceof Error ? e.message : e);
      }
    })();
  }, 15_000);
  console.log('[liarapilot] scheduler started (15s tick)');
}
