// Engine bootstrap: starts the in-process worker + scheduler exactly once,
// recovers stuck jobs from previous sessions (spec §12: "Persist enough
// workflow state to resume safely after process restarts").
import { db } from '@/lib/db';
import { startScheduler, processJobs } from './queue';

const g = globalThis as unknown as { __liarapilotEngine?: boolean };

export async function startEngine(): Promise<void> {
  if (g.__liarapilotEngine) return;
  g.__liarapilotEngine = true;
  try {
    // recover stale running jobs from a previous process
    const stale = await db.job.updateMany({
      where: { status: 'running' },
      data: { status: 'queued', runAt: new Date() },
    });
    if (stale.count > 0) console.log(`[liarapilot] requeued ${stale.count} stale job(s) from previous session`);

    // mark running workflows that never finished as failed (checkpoint allows
    // manual re-drive later; approvals stay valid per their expiry)
    const staleRuns = await db.workflowRun.updateMany({
      where: { status: 'running', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      data: { status: 'failed', error: 'interrupted by process restart' },
    });
    if (staleRuns.count > 0) console.log(`[liarapilot] marked ${staleRuns.count} stale run(s) as failed`);

    startScheduler();
    // initial drain
    void processJobs(10);
    console.log('[liarapilot] engine started (in-process worker + scheduler, no external queue)');
  } catch (e) {
    console.error('[liarapilot] engine bootstrap failed:', e instanceof Error ? e.message : e);
    g.__liarapilotEngine = false;
  }
}
