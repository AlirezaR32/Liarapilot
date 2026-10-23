// Approval service (spec §10): policy-boundary approvals with plan binding,
// expiry, and re-validation immediately before execution.
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { audit } from './audit';
import { redactValue } from '@/lib/security/redaction';

export const APPROVAL_TTL_MINUTES = 30; // spec §10

export interface CreateApprovalInput {
  projectId: string;
  userId: string;
  planId?: string | null;
  runId?: string | null;
  incidentId?: string | null;
  actionType: string;
  targetRef: string;
  title: string;
  rationale: string;
  evidence?: Record<string, unknown>;
  risks: { reversible: boolean; reasons: string[]; risk: string; failureEffects: string };
  planHash: string;
  payload: Record<string, unknown>;
}

export function planHashFor(plan: unknown): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

export async function createApproval(input: CreateApprovalInput) {
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MINUTES * 60_000);
  const approval = await db.approvalRequest.create({
    data: {
      projectId: input.projectId,
      planId: input.planId ?? null,
      runId: input.runId ?? null,
      incidentId: input.incidentId ?? null,
      userId: input.userId,
      actionType: input.actionType,
      targetRef: input.targetRef,
      title: input.title,
      rationale: input.rationale,
      evidenceJson: JSON.stringify(redactValue(input.evidence ?? {})),
      riskJson: JSON.stringify(redactValue(input.risks)),
      planHash: input.planHash,
      payloadJson: JSON.stringify(redactValue(input.payload)),
      status: 'pending',
      expiresAt,
    },
  });
  await audit('approval.requested', {
    userId: input.userId,
    projectId: input.projectId,
    detail: { approvalId: approval.id, actionType: input.actionType, targetRef: input.targetRef, planHash: input.planHash },
  });
  return approval;
}

export async function decideApproval(
  approvalId: string,
  userId: string,
  decision: 'approved' | 'rejected',
  note?: string,
) {
  const approval = await db.approvalRequest.findUnique({ where: { id: approvalId } });
  if (!approval) throw new Error('approval not found');
  if (approval.userId !== userId) throw new Error('approval does not belong to this user');
  if (approval.status !== 'pending') throw new Error(`approval already ${approval.status}`);
  if (approval.expiresAt.getTime() < Date.now()) {
    await db.approvalRequest.update({ where: { id: approvalId }, data: { status: 'expired' } });
    await audit('approval.expired', { userId, projectId: approval.projectId, detail: { approvalId } });
    throw new Error('approval request expired');
  }
  const updated = await db.approvalRequest.update({
    where: { id: approvalId },
    data: { status: decision, decidedAt: new Date() },
  });
  await audit(decision === 'approved' ? 'approval.granted' : 'approval.denied', {
    userId,
    projectId: approval.projectId,
    actor: 'user',
    detail: { approvalId, note: note ?? null },
  });
  return updated;
}

/**
 * Re-validate an approval immediately before execution (spec §10).
 * Binds to the exact planHash — a materially changed plan invalidates it.
 */
export async function validateApprovalForExecution(
  approvalId: string,
  expectedPlanHash: string,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; reason: string }> {
  const approval = await db.approvalRequest.findUnique({ where: { id: approvalId } });
  if (!approval) return { ok: false, reason: 'approval record missing' };
  if (approval.status === 'expired') return { ok: false, reason: 'approval expired' };
  if (approval.status !== 'approved') return { ok: false, reason: `approval not granted (status: ${approval.status})` };
  if (approval.planHash !== expectedPlanHash) return { ok: false, reason: 'plan changed since approval — approval invalidated' };
  if (approval.executedAt) return { ok: false, reason: 'approval already consumed (idempotency guard)' };
  return { ok: true, payload: JSON.parse(approval.payloadJson || '{}') as Record<string, unknown> };
}

export async function markApprovalExecuted(approvalId: string, ok: boolean) {
  await db.approvalRequest.update({
    where: { id: approvalId },
    data: { executedAt: new Date(), status: ok ? 'executed' : 'execution_failed' },
  });
}

/** Expire stale pending approvals — called by scheduler. */
export async function expireStaleApprovals(): Promise<number> {
  const stale = await db.approvalRequest.findMany({
    where: { status: 'pending', expiresAt: { lt: new Date() } },
    take: 50,
  });
  for (const a of stale) {
    await db.approvalRequest.update({ where: { id: a.id }, data: { status: 'expired' } });
    await audit('approval.expired', { userId: a.userId, projectId: a.projectId, detail: { approvalId: a.id } });
  }
  return stale.length;
}
