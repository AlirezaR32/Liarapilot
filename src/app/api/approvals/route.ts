import { db } from '@/lib/db';
import { resolveUser, json, mapError } from '@/lib/api';
import { redactValue } from '@/lib/security/redaction';

export const dynamic = 'force-dynamic';

/** Approval queue (spec §10): pending requests with full decision context. */
export async function GET(req: Request) {
  try {
    const user = await resolveUser();
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? 'pending';
    const where = status === 'all' ? { userId: user.id } : { userId: user.id, status };
    const approvals = await db.approvalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { project: { select: { name: true } } },
    });
    return json({
      approvals: approvals.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        projectName: a.project?.name ?? null,
        actionType: a.actionType,
        targetRef: a.targetRef,
        title: a.title,
        rationale: a.rationale,
        evidence: JSON.parse(a.evidenceJson || '{}'),
        risks: JSON.parse(a.riskJson || '{}'),
        planHash: a.planHash,
        payload: JSON.parse(a.payloadJson || '{}'),
        status: a.status,
        expiresAt: a.expiresAt,
        createdAt: a.createdAt,
        decidedAt: a.decidedAt,
        runId: a.runId,
        incidentId: a.incidentId,
      })),
    });
  } catch (e) {
    return mapError(e);
  }
}

export async function DELETE(req: Request) {
  // convenience: redacted audit view of past decisions
  try {
    const user = await resolveUser();
    const events = await db.auditEvent.findMany({
      where: { userId: user.id, kind: { startsWith: 'approval.' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return json({ history: events.map((e) => ({ id: e.id.toString(), kind: e.kind, detail: e.detailJson ? redactValue(JSON.parse(e.detailJson)) : null, at: e.createdAt })) });
  } catch (e) {
    return mapError(e);
  }
}
