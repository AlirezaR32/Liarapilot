import { db } from '@/lib/db';
import { resolveUser, json, mapError, readJson, isNonEmptyString } from '@/lib/api';
import { connectRepo } from '@/lib/services/projects';
import { createRun } from '@/lib/workers/runner';
import { enqueue } from '@/lib/workers/queue';
import { audit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await resolveUser();
    const projects = await db.project.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { createdAt: 'asc' },
      include: {
        incidents: { where: { status: { notIn: ['resolved', 'muted'] } }, orderBy: { lastSeenAt: 'desc' } },
        runs: { orderBy: { createdAt: 'desc' }, take: 1 },
        healthChecks: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { approvals: { where: { status: 'pending' } } } },
      },
    });

    const pendingApprovals = await db.approvalRequest.count({
      where: { userId: user.id, status: 'pending' },
    });

    return json({
      pendingApprovals,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        repo: `${p.repoOwner}/${p.repoName}`,
        repoProvider: p.repoProvider,
        branch: p.repoBranch,
        liaraAppName: p.liaraAppName,
        deployedSha: p.deployedSha,
        monitorPolicy: p.monitorPolicy,
        monitorEnabled: p.monitorEnabled,
        openIncidents: p.incidents.map((i) => ({ id: i.id, kind: i.kind, status: i.status, title: i.title, lastSeenAt: i.lastSeenAt })),
        lastRun: p.runs[0] ? { id: p.runs[0].id, kind: p.runs[0].kind, status: p.runs[0].status, stage: p.runs[0].stage, createdAt: p.runs[0].createdAt } : null,
        lastHealth: p.healthChecks[0] ? { status: p.healthChecks[0].status, httpStatus: p.healthChecks[0].httpStatus, latencyMs: p.healthChecks[0].latencyMs, at: p.healthChecks[0].createdAt } : null,
        pendingApprovals: p._count.approvals,
      })),
    });
  } catch (e) {
    return mapError(e);
  }
}

interface ConnectBody {
  owner?: string;
  name?: string;
  branch?: string;
  autoDeploy?: boolean;
  provider?: string; // "github" (default) | "gitlab"
}

/** Connect a repository — triggers automatic analysis (spec §7: a new
 *  repository connection triggers analysis automatically but NEVER an
 *  automatic production deployment). */
export async function POST(req: Request) {
  try {
    const user = await resolveUser();
    const body = await readJson<ConnectBody>(req);
    if (!isNonEmptyString(body.owner) || !isNonEmptyString(body.name)) {
      return json({ error: 'owner and name are required' }, 400);
    }
    const owner = body.owner.trim().replace(/[^A-Za-z0-9-_.]/g, '');
    const name = body.name.trim().replace(/[^A-Za-z0-9-_.]/g, '');

    const project = await connectRepo(user.id, { owner, name, branch: body.branch, provider: body.provider });
    await audit('project.connected', { userId: user.id, projectId: project.id, actor: 'user', detail: { repo: `${owner}/${name}`, provider: project.repoProvider } });

    const { runId } = await createRun({ projectId: project.id, userId: user.id, kind: 'deploy_pipeline', trigger: 'repo_connected' });
    await enqueue('run_workflow', { runId }, { priority: 2 });

    return json({ project: { id: project.id, name: project.name }, runId }, 201);
  } catch (e) {
    return mapError(e);
  }
}
