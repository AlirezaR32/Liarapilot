// Deployment plan/execution persistence (spec §8, §12).
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import type { DeploymentPlanData } from '@/lib/types';
import { audit } from './audit';

export function canonicalPlanHash(plan: DeploymentPlanData): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

export async function persistPlan(opts: {
  projectId: string;
  runId: string | null;
  commitSha: string | null;
  plan: DeploymentPlanData;
}): Promise<{ planId: string; planHash: string }> {
  const planHash = canonicalPlanHash(opts.plan);
  // supersede previous proposed plans for the same commit
  await db.deploymentPlan.updateMany({
    where: { projectId: opts.projectId, status: 'proposed' },
    data: { status: 'superseded' },
  });
  const row = await db.deploymentPlan.create({
    data: {
      projectId: opts.projectId,
      runId: opts.runId,
      commitSha: opts.commitSha ?? 'unknown',
      planHash,
      planJson: JSON.stringify(opts.plan),
      status: 'proposed',
    },
  });
  return { planId: row.id, planHash };
}

export async function markPlanStatus(planId: string, status: string): Promise<void> {
  await db.deploymentPlan.update({ where: { id: planId }, data: { status, updatedAt: new Date() } });
}

export async function createExecution(opts: {
  planId: string;
  projectId: string;
  commitSha: string | null;
  method: string;
  idempotencyKey?: string;
}): Promise<{ id: string; reused: boolean }> {
  const idempotencyKey = opts.idempotencyKey ?? `deploy:${opts.projectId}:${opts.commitSha ?? 'unknown'}`;
  const existing = await db.deploymentExecution.findUnique({ where: { idempotencyKey } });
  if (existing) return { id: existing.id, reused: true };
  const row = await db.deploymentExecution.create({
    data: {
      planId: opts.planId,
      projectId: opts.projectId,
      commitSha: opts.commitSha ?? 'unknown',
      method: opts.method,
      status: 'pending',
      idempotencyKey: opts.idempotencyKey ?? `deploy:${opts.projectId}:${randomUUID()}`,
    },
  });
  return { id: row.id, reused: false };
}

export async function startExecution(id: string): Promise<void> {
  await db.deploymentExecution.update({
    where: { id },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
  const ex = await db.deploymentExecution.findUnique({ where: { id } });
  await audit('execution.attempt', {
    projectId: ex?.projectId,
    detail: { executionId: id, method: ex?.method, attempt: ex?.attempts },
  });
}

export async function finalizeExecution(
  id: string,
  result: { ok: boolean; exitCode: number | null; stage?: string; result: Record<string, unknown> },
): Promise<void> {
  const ex = await db.deploymentExecution.findUnique({ where: { id } });
  await db.deploymentExecution.update({
    where: { id },
    data: {
      status: result.ok ? 'succeeded' : 'failed',
      stage: result.stage ?? null,
      exitCode: result.exitCode,
      resultJson: JSON.stringify(result.result),
      finishedAt: new Date(),
    },
  });
  await audit('execution.result', {
    projectId: ex?.projectId,
    detail: { executionId: id, ok: result.ok, exitCode: result.exitCode, stage: result.stage ?? null },
  });
}

export async function listExecutions(projectId: string, limit = 20) {
  return db.deploymentExecution.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { plan: true },
  });
}
