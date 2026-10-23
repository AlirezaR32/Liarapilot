// Workflow runner: creates runs, drives graphs, handles interrupts + resume.
import { randomUUID } from 'crypto';
import { Command } from '@langchain/langgraph';
import { db } from '@/lib/db';
import { emitEvent } from '@/lib/agent/state';
import { getDeployGraph } from '@/lib/agent/graph';
import { getInvestigateGraph } from '@/lib/agent/investigation';

export type RunKind = 'deploy_pipeline' | 'incident_investigation';
export type TriggerKind = 'repo_connected' | 'push_event' | 'manual_deploy' | 'manual_analyze' | 'health_check' | 'scheduled' | 'incident' | 'chat';

export async function createRun(opts: {
  projectId: string | null;
  userId: string;
  kind: RunKind;
  trigger: TriggerKind;
  input?: Record<string, unknown>;
}): Promise<{ runId: string; threadId: string }> {
  const threadId = randomUUID();
  const run = await db.workflowRun.create({
    data: {
      threadId,
      projectId: opts.projectId,
      userId: opts.userId,
      kind: opts.kind,
      trigger: opts.trigger,
      status: 'queued',
      inputJson: JSON.stringify(opts.input ?? {}),
    },
  });
  return { runId: run.id, threadId };
}

function isInterrupted(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && '__interrupt__' in result);
}

async function finalizeFromResult(runId: string, projectId: string | null, result: unknown): Promise<void> {
  if (isInterrupted(result)) {
    // approvalGate already persisted awaiting_approval + approval row.
    const run = await db.workflowRun.findUnique({ where: { id: runId } });
    if (run && run.status === 'running') {
      await db.workflowRun.update({ where: { id: runId }, data: { status: 'awaiting_approval' } });
    }
    await emitEvent(runId, 'runner', 'Workflow paused durably — waiting for user decision', 'warn');
    return;
  }
  // normal completion: report node already updated the run; sync status defensively
  const run = await db.workflowRun.findUnique({ where: { id: runId } });
  if (run && (run.status === 'running' || run.status === 'queued')) {
    const report = run.reportJson ? JSON.parse(run.reportJson) : null;
    const failed = report && report.outcome === 'failure';
    await db.workflowRun.update({
      where: { id: runId },
      data: { status: failed ? 'failed' : 'succeeded', finishedAt: new Date() },
    });
  }
  void projectId;
}

async function runStateFor(kind: RunKind, projectId: string, userId: string, runId: string, threadId: string, trigger: string, input?: Record<string, unknown>) {
  if (kind === 'deploy_pipeline') {
    return {
      projectId,
      userId,
      runId,
      threadId,
      trigger,
      input: input ?? {},
    } as never;
  }
  return {
    projectId,
    userId,
    runId,
    threadId,
    incidentId: String(input?.incidentId ?? ''),
  } as never;
}

/** Execute (or resume) a run by id. Returns final result. */
export async function executeRun(runId: string, resume?: { approved: boolean; decidedBy: string; note?: string }): Promise<{ status: string }> {
  const run = await db.workflowRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`run ${runId} not found`);

  await db.workflowRun.update({
    where: { id: runId },
    data: { status: run.status === 'awaiting_approval' ? 'awaiting_approval' : 'running', startedAt: run.startedAt ?? new Date() },
  });

  const config = { configurable: { thread_id: run.threadId } };
  try {
    if (resume) {
      const decision = { approved: resume.approved, decidedBy: resume.decidedBy, note: resume.note };
      await db.workflowRun.update({ where: { id: runId }, data: { status: run.kind === 'deploy_pipeline' ? 'running' : 'running', stage: 'resuming' } });
      await emitEvent(runId, 'runner', `Resuming workflow with user decision: ${resume.approved ? 'APPROVED' : 'REJECTED'}`, 'info');
      if (run.kind === 'deploy_pipeline') {
        const result = await getDeployGraph().invoke(new Command({ resume: decision }), config);
        await finalizeFromResult(runId, run.projectId, result);
      } else {
        const result = await getInvestigateGraph().invoke(new Command({ resume: decision }), config);
        await finalizeFromResult(runId, run.projectId, result);
      }
    } else {
      if (!run.projectId) throw new Error('run has no project');
      const input = run.inputJson ? (JSON.parse(run.inputJson) as Record<string, unknown>) : {};
      const state = await runStateFor(run.kind as RunKind, run.projectId, run.userId, runId, run.threadId, run.trigger, input);
      if (run.kind === 'deploy_pipeline') {
        const result = await getDeployGraph().invoke(state, config);
        await finalizeFromResult(runId, run.projectId, result);
      } else {
        const result = await getInvestigateGraph().invoke(state, config);
        await finalizeFromResult(runId, run.projectId, result);
      }
    }
    const after = await db.workflowRun.findUnique({ where: { id: runId } });
    return { status: after?.status ?? 'unknown' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.workflowRun.update({ where: { id: runId }, data: { status: 'failed', error: msg.slice(0, 1000), finishedAt: new Date() } });
    await emitEvent(runId, 'runner', `Workflow error: ${msg}`, 'error');
    return { status: 'failed' };
  }
}
