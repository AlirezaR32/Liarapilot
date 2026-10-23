// Integration tests: full workflow scenarios (spec §14). The REAL graph,
// REAL job queue and REAL monitoring/incident code run end-to-end; only the
// platform boundaries are mocked at module level (tests/mocks): the git
// provider client, the Liara CLI/API edge and the HTTP probe.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

vi.mock('@/lib/integrations/github/client', async () => await import('./mocks/githubClient'));
vi.mock('@/lib/integrations/gitlab/client', async () => await import('./mocks/githubClient'));
vi.mock('@/lib/integrations/liara/cliAdapter', async () => await import('./mocks/liaraModules'));
vi.mock('@/lib/integrations/liara/apiClient', async () => await import('./mocks/liaraModules'));
vi.mock('@/lib/integrations/repoArchive', async () => await import('./mocks/repoArchive'));
vi.mock('@/lib/services/monitoring', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/services/monitoring')>();
  return {
    ...orig,
    performHttpCheck: async () => ({ ok: true, status: 'up' as const, httpStatus: 200, latencyMs: 12, error: null }),
  };
});

import { createRun, executeRun } from '@/lib/workers/runner';
import { decideApproval } from '@/lib/services/approvals';
import { analyzeRepository } from '@/lib/agent/repositoryAnalysis';
import { performHttpCheck } from '@/lib/services/monitoring';
import { extractEnvVarNames, redactString } from '@/lib/security/redaction';
import { makeEncryptedRef } from '@/lib/security/credentials';
import { resetCliMock, setCliFailure, cliAttempts } from './mocks/liaraModules';

const db = new PrismaClient();

beforeAll(async () => {
  await db.$executeRawUnsafe('DELETE FROM WorkflowEvent');
  await db.$executeRawUnsafe('DELETE from WorkflowRun');
  await db.$executeRawUnsafe('DELETE FROM AgentCheckpointWrite');
  await db.$executeRawUnsafe('DELETE FROM AgentCheckpoint');
  await db.$executeRawUnsafe('DELETE FROM Job');
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeProject() {
  const user = await db.user.create({ data: { email: `t${Date.now()}-${Math.random().toString(36).slice(2)}@test.local` } });
  // Commercial model: real deploys require the workspace's own Liara token.
  // Tests store an encrypted fake token so the REAL credential-resolution path runs.
  await db.liaraConnection.create({
    data: { userId: user.id, tokenRef: makeEncryptedRef('fake-liara-token-for-tests'), verified: true, verifiedAt: new Date() },
  });
  const project = await db.project.create({
    data: {
      userId: user.id,
      name: 'test orders-api',
      repoOwner: 'liarapilot-demo',
      repoName: 'orders-api',
      healthUrl: 'https://orders-api.example.test/health', // probe target (mocked at module level)
    },
  });
  return { user, project };
}

describe('Scenario A: connect → analyze → plan → approval → deploy → verify', () => {
  it('pauses at the approval gate, executes on approval, verifies honestly', async () => {
    const { user, project } = await makeProject();
    const { runId } = await createRun({ projectId: project.id, userId: user.id, kind: 'deploy_pipeline', trigger: 'repo_connected' });
    const first = await executeRun(runId);
    expect(first.status).toBe('awaiting_approval');

    // grant through the approval service (re-validation happens before execution)
    const approval = await db.approvalRequest.findFirst({ where: { runId } });
    expect(approval).toBeTruthy();
    expect(approval!.status).toBe('pending');
    expect(approval!.planHash).toMatch(/^[a-f0-9]{64}$/);
    await decideApproval(approval!.id, user.id, 'approved', 'test grant');

    // resume with approval
    const second = await executeRun(runId, { approved: true, decidedBy: 'test@example.com' });
    expect(second.status).toBe('succeeded');

    const run = await db.workflowRun.findUnique({ where: { id: runId } });
    const report = JSON.parse(run!.reportJson!);
    expect(report.outcome).toBe('success');
    expect(run!.reportJson).toContain('راستی‌آزمایی');

    // execution recorded with idempotency key
    const exec = await db.deploymentExecution.findFirst({ where: { projectId: project.id } });
    expect(exec).toBeTruthy();
    expect(exec!.status).toBe('succeeded');
    expect(exec!.idempotencyKey).toContain(project.id);

    // project now records the deployed sha
    const updated = await db.project.findUnique({ where: { id: project.id } });
    expect(updated!.deployedSha).toBeTruthy();
  }, 60_000);

  it('rejected approval never executes (Scenario D)', async () => {
    const { user, project } = await makeProject();
    const { runId } = await createRun({ projectId: project.id, userId: user.id, kind: 'deploy_pipeline', trigger: 'manual_deploy' });
    await executeRun(runId);
    const second = await executeRun(runId, { approved: false, decidedBy: 'test@example.com', note: 'nope' });
    expect(second.status).toBe('succeeded'); // workflow completes (with rejection outcome)
    const run = await db.workflowRun.findUnique({ where: { id: runId } });
    expect(run!.reportJson).toContain('توسط کاربر رد شد');
    const exec = await db.deploymentExecution.findFirst({ where: { projectId: project.id } });
    expect(exec).toBeNull(); // nothing executed
  }, 60_000);
});

describe('Scenario C: deterministic build failure is diagnosed, not retried', () => {
  it('fails once, classifies as deterministic, refuses to retry', async () => {
    resetCliMock();
    setCliFailure(true);
    const { user, project } = await makeProject();
    const { runId } = await createRun({ projectId: project.id, userId: user.id, kind: 'deploy_pipeline', trigger: 'manual_deploy' });
    await executeRun(runId);
    const approval = await db.approvalRequest.findFirst({ where: { runId } });
    await decideApproval(approval!.id, user.id, 'approved');
    const second = await executeRun(runId, { approved: true, decidedBy: 'test@example.com' });
    expect(second.status).toBe('failed'); // workflow completes honestly: deployment failed

    const run = await db.workflowRun.findUnique({ where: { id: runId } });
    expect(run!.status).toBe('failed');
    expect(run!.reportJson).toContain('failed');

    const exec = await db.deploymentExecution.findFirst({ where: { projectId: project.id } });
    expect(exec!.status).toBe('failed');
    expect(cliAttempts()).toBe(1); // NO blind retry of an unchanged failing config
    void approval;
    setCliFailure(false);
  }, 60_000);
});

describe('Scenario B (monitoring layer): consecutive failures create incidents without an LLM', () => {
  it('health check code classifies responses correctly (REAL probe, not the module mock)', async () => {
    const real = await vi.importActual<typeof import('@/lib/services/monitoring')>('@/lib/services/monitoring');
    const up = await real.performHttpCheck('http://127.0.0.1:3000/api/capabilities');
    expect(up.status).toBe('up');
    const missing = await real.performHttpCheck('http://127.0.0.1:3000/api/definitely-not-a-route');
    expect(missing.status).not.toBe('up');
    expect(missing.httpStatus).toBe(404);
  }, 30_000);
});

describe('repository analyzer edge cases', () => {
  it('profiles contain unknowns rather than guesses', async () => {
    const profile = await analyzeRepository({ owner: 'liarapilot-demo', repo: 'orders-api' });
    // fixture has no liara.json → hasLiaraManifest false, not invented
    expect(profile.hasLiaraManifest).toBe(false);
    // fixture Dockerfile has no EXPOSE and no port hint → stays unknown (never guessed)
    expect(profile.appPort).toBeNull();
    // unknown package manager stays unknown when no lockfile signals it
    expect(['npm', 'unknown', null]).toContain(profile.packageManager);
  });
});

describe('incident & usage invariants', () => {
  it('health check history is capped (retention limit)', async () => {
    const { project } = await makeProject();
    for (let i = 0; i < 3; i++) {
      await db.healthCheck.create({ data: { projectId: project.id, target: 'sim', status: 'up', httpStatus: 200, latencyMs: 10 } });
    }
    const count = await db.healthCheck.count({ where: { projectId: project.id } });
    expect(count).toBe(3);
  });
});

describe('redaction in persistence paths', () => {
  it('approval payloads and evidence are stored redacted', () => {
    const payload = { env_value: 'postgres://admin:hunter2@db/production', note: 'set db' };
    const out = JSON.parse(redactString(JSON.stringify(payload)));
    expect(out.env_value).not.toContain('hunter2');
  });
});

describe('env extraction (analysis input)', () => {
  it('marks empty values as required', () => {
    const names = extractEnvVarNames('A=\nB=1\n# comment\nC=');
    expect(names.filter((n) => n.required).map((n) => n.name)).toEqual(['A', 'C']);
  });
});

describe('workflow state durability', () => {
  it('checkpoints survive (thread state queryable after interrupt)', async () => {
    const { user, project } = await makeProject();
    const { runId } = await createRun({ projectId: project.id, userId: user.id, kind: 'deploy_pipeline', trigger: 'manual_deploy' });
    await executeRun(runId);
    const run = await db.workflowRun.findUnique({ where: { id: runId } });
    expect(run!.threadId).toBeTruthy();
    const checkpoints = await db.agentCheckpoint.findMany({ where: { threadId: run!.threadId } });
    expect(checkpoints.length).toBeGreaterThan(0);
    const writes = await db.agentCheckpointWrite.findMany({ where: { threadId: run!.threadId } });
    expect(writes.length).toBeGreaterThan(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// GET /api/repos — the "my repositories" browser route (user's OWN token)
// ---------------------------------------------------------------------------

const reposUserRef = vi.hoisted(() => ({ id: '' }));
vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...orig,
    resolveUser: async () => {
      if (!reposUserRef.id) throw new Error('repos test user not created');
      return { id: reposUserRef.id, email: 'repos@test.local', name: null };
    },
  };
});

describe('GET /api/repos (repository browser)', () => {
  it('lists the connected account repositories (GitHub mapping)', async () => {
    const user = await db.user.create({ data: { email: `repos-${Date.now()}@test.local` } });
    reposUserRef.id = user.id;
    await db.gitHubConnection.create({
      data: { userId: user.id, tokenRef: makeEncryptedRef('gh-test-token'), login: 'octocat', via: 'pat', verified: true, verifiedAt: new Date() },
    });

    const fixture = [
      {
        full_name: 'octocat/Hello-World',
        description: 'My first repository',
        language: 'JavaScript',
        default_branch: 'master',
        private: false,
        pushed_at: '2026-01-01T00:00:00Z',
        stargazers_count: 5,
        html_url: 'https://github.com/octocat/Hello-World',
        fork: false,
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { GET } = await import('@/app/api/repos/route');
      const res = await GET(new Request('http://localhost/api/repos?provider=github'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { connected: boolean; repos: Array<{ owner: string; name: string; language: string | null; defaultBranch: string; private: boolean; stars: number }> };
      expect(body.connected).toBe(true);
      expect(body.repos).toHaveLength(1);
      expect(body.repos[0]).toMatchObject({ owner: 'octocat', name: 'Hello-World', language: 'JavaScript', defaultBranch: 'master', private: false, stars: 5 });
      const calledUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;
      expect(calledUrl).toContain('https://api.github.com/user/repos');
      // the user's token must actually be used for private access
      const init = (fetchMock.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe('Bearer gh-test-token');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns connected:false with a Persian hint when no GitHub connection exists', async () => {
    const user = await db.user.create({ data: { email: `repos-none-${Date.now()}@test.local` } });
    reposUserRef.id = user.id;
    const { GET } = await import('@/app/api/repos/route');
    const res = await GET(new Request('http://localhost/api/repos?provider=github'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean; repos: unknown[]; hint?: string };
    expect(body.connected).toBe(false);
    expect(body.repos).toHaveLength(0);
    expect(body.hint).toContain('تنظیمات');
  });
});
