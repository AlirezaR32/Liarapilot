import { db } from '@/lib/db';
import { resolveUser, json, mapError } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Transparent usage & cost accounting (spec §9 monitoring cost controls). */
export async function GET() {
  try {
    const user = await resolveUser();
    const since = new Date(Date.now() - 24 * 3600_000);
    const rows = await db.usageRecord.groupBy({
      by: ['kind'],
      where: { userId: user.id, createdAt: { gte: since } },
      _sum: { quantity: true, tokensIn: true, tokensOut: true },
    });
    const llmCalls = rows.find((r) => r.kind === 'investigation')?._sum.quantity ?? 0;
    const checks = rows.find((r) => r.kind === 'health_check')?._sum.quantity ?? 0;
    return json({
      windowHours: 24,
      llmInvestigations: llmCalls,
      healthChecks: checks,
      byKind: rows.map((r) => ({ kind: r.kind, quantity: r._sum.quantity ?? 0, tokensIn: r._sum.tokensIn ?? 0, tokensOut: r._sum.tokensOut ?? 0 })),
    });
  } catch (e) {
    return mapError(e);
  }
}
