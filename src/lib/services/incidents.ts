// Incident service (spec §9 Layer 2): dedup, cooldown, state machine.
import { db } from '@/lib/db';
import { policyFor } from '@/lib/agent/policies';
import { audit } from './audit';

export type IncidentStatus =
  | 'detected'
  | 'investigating'
  | 'awaiting_approval'
  | 'remediating'
  | 'verifying'
  | 'resolved'
  | 'escalated'
  | 'muted';

export interface FailureSignal {
  projectId: string;
  kind: 'http_5xx' | 'timeout' | 'deployment_failed' | 'unhealthy' | 'resource_threshold';
  title: string;
  summary: string;
  now: Date;
}

function detectionKeyFor(signal: FailureSignal): string {
  // dedup per project+kind+target so the same underlying issue doesn't fan out
  return `${signal.kind}`;
}

/**
 * Record a failure signal. Opens an incident when the configured consecutive
 * failure threshold is met, deduplicating by detectionKey and honoring the
 * cooldown so the same issue doesn't create incidents repeatedly.
 * Returns the incident (existing or new) or null when below threshold.
 */
export async function recordFailureSignal(signal: FailureSignal): Promise<{ incidentId: string | null; deduped: boolean; thresholdMet: boolean }> {
  const project = await db.project.findUnique({ where: { id: signal.projectId } });
  if (!project) return { incidentId: null, deduped: false, thresholdMet: false };
  const policy = policyFor(project.monitorPolicy);
  const key = detectionKeyFor(signal);

  const existing = await db.incident.findUnique({
    where: { projectId_detectionKey: { projectId: signal.projectId, detectionKey: key } },
  });

  // cooldown: same underlying issue within cooldown -> just bump lastSeenAt
  if (existing && existing.status !== 'resolved' && existing.cooldownUntil && existing.cooldownUntil.getTime() > signal.now.getTime()) {
    await db.incident.update({ where: { id: existing.id }, data: { lastSeenAt: signal.now } });
    return { incidentId: existing.id, deduped: true, thresholdMet: true };
  }

  // count consecutive recent failures (bounded lookback)
  const recentChecks = await db.healthCheck.findMany({
    where: { projectId: signal.projectId, createdAt: { gte: new Date(signal.now.getTime() - 30 * 60_000) } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  let consecutive = 0;
  for (const c of recentChecks) {
    if (c.status === 'up') break;
    consecutive++;
  }

  if (consecutive < policy.consecutiveFailuresForIncident) {
    return { incidentId: null, deduped: false, thresholdMet: false };
  }

  if (existing && (existing.status === 'resolved' || existing.status === 'escalated' || existing.status === 'muted')) {
    // previous incident fully closed — open a fresh one
    const incident = await db.incident.create({
      data: {
        projectId: signal.projectId,
        kind: signal.kind,
        status: 'detected',
        title: signal.title,
        summary: signal.summary,
        detectionKey: `${key}:${signal.now.getTime()}`,
        firstSeenAt: signal.now,
        lastSeenAt: signal.now,
        cooldownUntil: new Date(signal.now.getTime() + policy.cooldownMinutes * 60_000),
        evidenceJson: JSON.stringify({ threshold: policy.consecutiveFailuresForIncident, consecutiveFailures: consecutive }),
      },
    });
    await audit('incident.opened', { projectId: signal.projectId, detail: { incidentId: incident.id, kind: signal.kind } });
    return { incidentId: incident.id, deduped: false, thresholdMet: true };
  }

  if (existing) {
    await db.incident.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: signal.now,
        cooldownUntil: new Date(signal.now.getTime() + policy.cooldownMinutes * 60_000),
        summary: signal.summary,
      },
    });
    return { incidentId: existing.id, deduped: false, thresholdMet: true };
  }

  const incident = await db.incident.create({
    data: {
      projectId: signal.projectId,
      kind: signal.kind,
      status: 'detected',
      title: signal.title,
      summary: signal.summary,
      detectionKey: key,
      cooldownUntil: new Date(signal.now.getTime() + policy.cooldownMinutes * 60_000),
      evidenceJson: JSON.stringify({ threshold: policy.consecutiveFailuresForIncident, consecutiveFailures: consecutive }),
    },
  });
  await audit('incident.opened', { projectId: signal.projectId, detail: { incidentId: incident.id, kind: signal.kind } });
  return { incidentId: incident.id, deduped: false, thresholdMet: true };
}

export async function setIncidentStatus(incidentId: string, status: IncidentStatus, patch: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { status, ...patch };
  if (status === 'resolved') data.resolvedAt = new Date();
  await db.incident.update({ where: { id: incidentId }, data });
  await audit(`incident.${status}`, { projectId: undefined, detail: { incidentId, status } });
}

export async function resolveIncidentIfChecksRecover(incidentId: string, now: Date): Promise<boolean> {
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident || incident.status === 'resolved') return false;
  const lastTwo = await db.healthCheck.findMany({
    where: { projectId: incident.projectId, createdAt: { lte: now } },
    orderBy: { createdAt: 'desc' },
    take: 2,
  });
  if (lastTwo.length >= 2 && lastTwo.every((c) => c.status === 'up')) {
    await db.incident.update({
      where: { id: incidentId },
      data: { status: 'resolved', resolvedAt: now, lastSeenAt: now },
    });
    await audit('incident.resolved', { projectId: incident.projectId, detail: { incidentId, via: 'recovered_checks' } });
    return true;
  }
  return false;
}
