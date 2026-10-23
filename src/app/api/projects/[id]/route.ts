import { db } from '@/lib/db';
import { resolveUser, json, mapError, requireProject } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUser();
    const { id } = await params;
    const project = await requireProject(id, user.id);

    const [latestSnapshot, plans, executions, incidents, runs, checks, approvals] = await Promise.all([
      db.analysisSnapshot.findUnique({
        where: { projectId_commitSha: { projectId: project.id, commitSha: project.lastProfileSha ?? 'none' } },
      }),
      db.deploymentPlan.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      db.deploymentExecution.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      db.incident.findMany({ where: { projectId: project.id }, orderBy: { lastSeenAt: 'desc' }, take: 10 }),
      db.workflowRun.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      db.healthCheck.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 40 }),
      db.approvalRequest.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    return json({
      project: {
        id: project.id,
        name: project.name,
        repoOwner: project.repoOwner,
        repoName: project.repoName,
        repoBranch: project.repoBranch,
        liaraAppName: project.liaraAppName,
        deployedSha: project.deployedSha,
        lastProfileSha: project.lastProfileSha,
        monitorPolicy: project.monitorPolicy,
        monitorEnabled: project.monitorEnabled,
        healthUrl: project.healthUrl,
        createdAt: project.createdAt,
      },
      profile: latestSnapshot ? JSON.parse(latestSnapshot.profileJson) : null,
      plans: plans.map((p) => ({ id: p.id, status: p.status, planHash: p.planHash, commitSha: p.commitSha, plan: JSON.parse(p.planJson), createdAt: p.createdAt })),
      executions: executions.map((e) => ({
        id: e.id,
        method: e.method,
        status: e.status,
        stage: e.stage,
        exitCode: e.exitCode,
        commitSha: e.commitSha,
        attempts: e.attempts,
        result: e.resultJson ? JSON.parse(e.resultJson) : null,
        createdAt: e.createdAt,
        finishedAt: e.finishedAt,
      })),
      incidents: incidents.map((i) => ({ id: i.id, kind: i.kind, status: i.status, title: i.title, summary: i.summary, firstSeenAt: i.firstSeenAt, lastSeenAt: i.lastSeenAt, resolvedAt: i.resolvedAt })),
      runs: runs.map((r) => ({ id: r.id, kind: r.kind, trigger: r.trigger, status: r.status, stage: r.stage, createdAt: r.createdAt, finishedAt: r.finishedAt, report: r.reportJson ? JSON.parse(r.reportJson) : null })),
      healthChecks: checks.map((c) => ({ id: c.id, status: c.status, httpStatus: c.httpStatus, latencyMs: c.latencyMs, error: c.error, at: c.createdAt })),
      approvals: approvals.map((a) => ({ id: a.id, actionType: a.actionType, title: a.title, status: a.status, createdAt: a.createdAt, expiresAt: a.expiresAt })),
    });
  } catch (e) {
    return mapError(e);
  }
}
