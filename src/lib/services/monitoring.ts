// Lightweight monitoring (spec §9 Layer 1): plain code, no LLM.
// HTTP availability checks + status classification + latency measurement.
// Targets are always REAL public URLs provided per project (healthUrl).

import { db } from '@/lib/db';
import { checkIntervalFor, policyFor } from '@/lib/agent/policies';
import { recordFailureSignal } from './incidents';
import { recordUsage } from './audit';

export interface CheckResult {
  ok: boolean;
  status: 'up' | 'down' | 'degraded';
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
}

export function healthTargetUrl(project: { healthUrl: string | null }): string | null {
  return project.healthUrl && /^https?:\/\//.test(project.healthUrl) ? project.healthUrl : null;
}

export async function performHttpCheck(url: string, timeoutMs = 5000): Promise<CheckResult> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    const latencyMs = Date.now() - started;
    const ok2xx3xx = res.status >= 200 && res.status < 400;
    return {
      ok: ok2xx3xx,
      status: ok2xx3xx ? 'up' : res.status >= 500 ? 'down' : 'degraded',
      httpStatus: res.status,
      latencyMs,
      error: ok2xx3xx ? null : `HTTP ${res.status}`,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    const timeout = /abort|timeout/i.test(msg);
    return {
      ok: false,
      status: 'down',
      httpStatus: null,
      latencyMs,
      error: timeout ? 'timeout' : msg.slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Persist a health check, honor retention (spec §12), feed incident logic. */
export async function checkProject(projectId: string, now = new Date()): Promise<CheckResult | null> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project || !project.monitorEnabled) return null;

  const url = healthTargetUrl(project);
  if (!url) return null; // no real public URL configured — nothing to probe
  const result = await performHttpCheck(url);

  await db.healthCheck.create({
    data: {
      projectId: project.id,
      target: url,
      status: result.status,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      error: result.error,
      createdAt: now,
    },
  });

  // retention: keep last 500 per project (bounded history)
  const count = await db.healthCheck.count({ where: { projectId: project.id } });
  if (count > 500) {
    const oldest = await db.healthCheck.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
      take: count - 500,
      select: { id: true },
    });
    await db.healthCheck.deleteMany({ where: { id: { in: oldest.map((o) => o.id) } } });
  }

  await recordUsage('health_check', { projectId: project.id, userId: project.userId });

  // incident logic — only when failing
  if (!result.ok) {
    const kind = result.error === 'timeout' ? 'timeout' : result.httpStatus && result.httpStatus >= 500 ? 'http_5xx' : 'unhealthy';
    const signal: Parameters<typeof recordFailureSignal>[0] = {
      projectId: project.id,
      kind,
      title:
        kind === 'timeout'
          ? 'سرویس پاسخ نمی‌دهد (تایم‌اوت)'
          : kind === 'http_5xx'
            ? `سرویس خطای HTTP 5xx برمی‌گرداند (آخرین: ${result.httpStatus})`
            : `سرویس ناسالم است (آخرین: ${result.error ?? 'نامشخص'})`,
      summary: `بررسی HTTP شکست خورد ${result.error ?? ''} — ${consecutiveFailuresLabel(project.id)}`.trim(),
      now,
    };
    const res = await recordFailureSignal(signal);
    void res;
    return result;
  }

  // recovery: auto-resolve incidents whose checks recover
  const openIncidents = await db.incident.findMany({
    where: { projectId: project.id, status: { in: ['detected', 'investigating', 'awaiting_approval', 'remediating', 'verifying'] } },
    take: 5,
  });
  for (const inc of openIncidents) {
    const lastTwo = await db.healthCheck.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    if (lastTwo.length >= 2 && lastTwo.every((c) => c.status === 'up')) {
      await db.incident.update({ where: { id: inc.id }, data: { status: 'resolved', resolvedAt: now } });
    }
  }

  return result;
}

function consecutiveFailuresLabel(projectId: string): string {
  return 'شکست متوالی تشخیص‌داده‌شده توسط مانیتور زمان‌بندی‌شده';
}

/** Scheduler sweep: check all due projects; enqueue investigations for new incidents. */
export async function monitorSweep(now = new Date()): Promise<{ checked: number; newIncidents: string[] }> {
  const projects = await db.project.findMany({ where: { archived: false, monitorEnabled: true } });
  const newIncidents: string[] = [];
  let checked = 0;

  for (const project of projects) {
    const interval = checkIntervalFor(project.monitorPolicy, project.checkIntervalS);
    const last = await db.healthCheck.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
    });
    if (last && now.getTime() - last.createdAt.getTime() < interval * 1000) continue; // not due

    const result = await checkProject(project.id, now);
    checked++;
    if (result && !result.ok) {
      // threshold/dedup handled inside recordFailureSignal; detect NEW incidents to investigate
      const policy = policyFor(project.monitorPolicy);
      const recent = await db.incident.findFirst({
        where: {
          projectId: project.id,
          status: 'detected',
          createdAt: { gte: new Date(now.getTime() - 60_000) },
        },
      });
      if (recent && policy.investigationBudgetPerDay > 0) {
        const todayCount = await countInvestigationsToday(project.id, now);
        if (todayCount < policy.investigationBudgetPerDay) {
          newIncidents.push(recent.id);
        }
      }
    }
  }
  return { checked, newIncidents };
}

export async function countInvestigationsToday(projectId: string, now: Date): Promise<number> {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return db.usageRecord.count({
    where: { projectId, kind: 'investigation', createdAt: { gte: startOfDay } },
  });
}
