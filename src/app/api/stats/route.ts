import { db } from '@/lib/db';
import { resolveUser, json, mapError } from '@/lib/api';

export const dynamic = 'force-dynamic';

// Aggregated workspace stats for the dashboard view. All numbers are
// tenant-scoped (resolveUser) like every other route.
export async function GET() {
  try {
    const user = await resolveUser();

    const since14d = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);

    const [projects, runs, incidents, approvals, checks24h, recentRuns] = await Promise.all([
      db.project.findMany({
        where: { userId: user.id, archived: false },
        select: { id: true, name: true, repoProvider: true, deployedSha: true, monitorEnabled: true },
      }),
      db.workflowRun.findMany({
        where: { userId: user.id, createdAt: { gte: since14d } },
        select: { id: true, kind: true, status: true, createdAt: true },
      }),
      db.incident.findMany({
        where: { project: { userId: user.id } },
        select: { id: true, kind: true, status: true },
      }),
      db.approvalRequest.findMany({
        where: { userId: user.id },
        select: { id: true, status: true },
      }),
      db.healthCheck.findMany({
        where: { project: { userId: user.id }, createdAt: { gte: since24h } },
        select: { status: true, latencyMs: true },
      }),
      db.workflowRun.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, kind: true, status: true, trigger: true, createdAt: true, project: { select: { name: true } } },
      }),
    ]);

    const ACTIVE = ['queued', 'running', 'awaiting_approval', 'verifying'];
    const succeeded = runs.filter((r) => r.status === 'succeeded').length;
    const failed = runs.filter((r) => r.status === 'failed').length;
    const active = runs.filter((r) => ACTIVE.includes(r.status)).length;
    const finished = succeeded + failed;

    // Runs per day for the last 14 days (oldest first)
    const byDay: Array<{ day: string; total: number; succeeded: number; failed: number; active: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      const key = d.toISOString().slice(0, 10);
      const dayRuns = runs.filter((r) => r.createdAt.toISOString().slice(0, 10) === key);
      byDay.push({
        day: key,
        total: dayRuns.length,
        succeeded: dayRuns.filter((r) => r.status === 'succeeded').length,
        failed: dayRuns.filter((r) => r.status === 'failed').length,
        active: dayRuns.filter((r) => ACTIVE.includes(r.status)).length,
      });
    }

    const OPEN_INCIDENT = ['detected', 'investigating', 'awaiting_approval', 'remediating', 'verifying', 'escalated'];
    const byKind: Record<string, number> = {};
    for (const inc of incidents) byKind[inc.kind] = (byKind[inc.kind] ?? 0) + 1;

    const upChecks = checks24h.filter((c) => c.status === 'up').length;
    const latencies = checks24h.map((c) => c.latencyMs).filter((n): n is number => typeof n === 'number');

    return json({
      projects: {
        total: projects.length,
        deployed: projects.filter((p) => p.deployedSha).length,
        byProvider: projects.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.repoProvider]: (acc[p.repoProvider] ?? 0) + 1 }), {}),
      },
      runs14d: {
        total: runs.length,
        succeeded,
        failed,
        active,
        successRate: finished > 0 ? Math.round((succeeded / finished) * 100) : null,
        byDay,
      },
      incidents: {
        open: incidents.filter((i) => OPEN_INCIDENT.includes(i.status)).length,
        resolved: incidents.filter((i) => ['resolved', 'muted'].includes(i.status)).length,
        byKind,
      },
      approvals: {
        pending: approvals.filter((a) => a.status === 'pending').length,
        approved: approvals.filter((a) => ['approved', 'executed'].includes(a.status)).length,
        rejected: approvals.filter((a) => a.status === 'rejected').length,
      },
      health24h: {
        checks: checks24h.length,
        upRate: checks24h.length > 0 ? Math.round((upChecks / checks24h.length) * 100) : null,
        avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      },
      recentRuns: recentRuns.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        trigger: r.trigger,
        projectName: r.project?.name ?? null,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    return mapError(e);
  }
}
