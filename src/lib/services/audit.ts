// Audit trail (spec §10): every approval, execution attempt, verification.
import { db } from '@/lib/db';
import { redactValue } from '@/lib/security/redaction';

export async function audit(
  kind: string,
  opts: { userId?: string | null; projectId?: string | null; actor?: 'agent' | 'user' | 'system'; detail?: Record<string, unknown> },
): Promise<void> {
  await db.auditEvent.create({
    data: {
      kind,
      userId: opts.userId ?? null,
      projectId: opts.projectId ?? null,
      actor: opts.actor ?? 'agent',
      detailJson: opts.detail ? JSON.stringify(redactValue(opts.detail)) : null,
    },
  });
}

export async function recordUsage(
  kind: string,
  opts: { userId?: string | null; projectId?: string | null; quantity?: number; tokensIn?: number; tokensOut?: number; note?: string },
): Promise<void> {
  await db.usageRecord.create({
    data: {
      kind,
      userId: opts.userId ?? null,
      projectId: opts.projectId ?? null,
      quantity: opts.quantity ?? 1,
      tokensIn: opts.tokensIn ?? 0,
      tokensOut: opts.tokensOut ?? 0,
      note: opts.note ?? null,
    },
  });
}
