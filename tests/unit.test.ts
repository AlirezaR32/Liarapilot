// Unit tests: deterministic logic only (no network, no LLM, no DB).
// Covers spec §14 unit-test list. Provider boundaries are mocked at module
// level (tests/mocks) so the REAL analyzer code runs offline.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/integrations/github/client', async () => await import('./mocks/githubClient'));
vi.mock('@/lib/integrations/gitlab/client', async () => await import('./mocks/githubClient'));
import { analyzeRepository } from '@/lib/agent/repositoryAnalysis';
import { classifyRisk, policyFor, shouldRetryDeployment, classifyDeploymentFailure, checkIntervalFor, MONITOR_POLICIES } from '@/lib/agent/policies';
import { redactValue, redactString, extractEnvVarNames, boundAndRedact } from '@/lib/security/redaction';
import { buildValidatedCommand, CommandValidationError, isConsequential, COMMAND_TEMPLATES } from '@/lib/security/commandValidation';
import { planHashFor } from '@/lib/services/approvals';
import { projectNameForLiara } from '@/lib/services/projects';

describe('repository analysis (fixture mode)', () => {
  it('extracts a structured profile with evidence and confidence', async () => {
    const profile = await analyzeRepository({ owner: 'liarapilot-demo', repo: 'orders-api' });
    expect(profile.language).toBe('JavaScript/TypeScript');
    expect(profile.framework).toBe('Express');
    expect(profile.startCommand).toBe('node dist/server.js');
    expect(profile.buildCommand).toBe('tsc -p tsconfig.json');
    expect(profile.packageManager).toBe('npm');
    expect(profile.hasDockerfile).toBe(true);
    expect(profile.hasLiaraManifest).toBe(false);
    expect(profile.analyzedSha).toBeTruthy();
    // env var NAMES only; values never captured
    const names = profile.requiredEnvVars.map((v) => v.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('JWT_SECRET');
    expect(JSON.stringify(profile)).not.toMatch(/postgres:\/\//);
    // evidence exists and references files
    expect(profile.evidence.length).toBeGreaterThan(3);
    expect(profile.evidence.some((e) => e.file === 'package.json')).toBe(true);
    expect(profile.deploymentCandidates.length).toBeGreaterThan(0);
    expect(profile.isDeployable).toBe(true);
  });

  it('is deterministic and cacheable by revision', async () => {
    const a = await analyzeRepository({ owner: 'liarapilot-demo', repo: 'orders-api' });
    const b = await analyzeRepository({ owner: 'liarapilot-demo', repo: 'orders-api' });
    expect(a.analyzedSha).toBe(b.analyzedSha);
    expect(a.framework).toBe(b.framework);
  });
});

describe('risk classification (policy engine)', () => {
  it('marks read/analyze actions safe to automate', () => {
    for (const action of ['read_repository_files', 'analyze_project', 'http_health_check', 'collect_logs', 'prepare_deployment_plan'] as const) {
      const r = classifyRisk(action);
      expect(r.requiresApproval).toBe(false);
      expect(r.risk).toBe('low');
    }
  });

  it('requires approval for consequential operations by default', () => {
    for (const action of ['deploy_production', 'restart_app', 'set_env', 'rollback_deployment', 'repo_write', 'delete_resource'] as const) {
      const r = classifyRisk(action);
      expect(r.requiresApproval).toBe(true);
    }
  });

  it('treats paid resources and deletes as high risk', () => {
    expect(classifyRisk('create_app', { involvesPaidResource: true }).risk).toBe('high');
    expect(classifyRisk('delete_resource').risk).toBe('high');
    expect(classifyRisk('deploy_production', { isProduction: true }).risk).toBe('high');
  });

  it('fails closed on unknown action types', () => {
    // @ts-expect-error intentional unknown action
    const r = classifyRisk('make_me_coffee');
    expect(r.requiresApproval).toBe(true);
    expect(r.risk).toBe('high');
  });
});

describe('retry policy', () => {
  it('refuses to retry deterministic failures (no blind redeploy)', () => {
    const r = shouldRetryDeployment(1, 'deterministic', 3);
    expect(r.retry).toBe(false);
    expect(r.reason).toMatch(/قطعی/);
  });

  it('allows one bounded retry for transient failures and honors budgets', () => {
    expect(shouldRetryDeployment(0, 'transient', 2).retry).toBe(true);
    expect(shouldRetryDeployment(2, 'transient', 2).retry).toBe(false); // budget exhausted
    expect(shouldRetryDeployment(0, 'unknown', 3).retry).toBe(false);
  });
});

describe('deployment failure classification', () => {
  it('classifies compile errors as deterministic build failures', () => {
    const r = classifyDeploymentFailure('error TS2307: Cannot find module "./payment-gateway"', '=> Building project');
    expect(r.kind).toBe('deterministic');
    expect(r.stage).toBe('build');
  });

  it('classifies network errors as possibly transient', () => {
    const r = classifyDeploymentFailure('', 'ETIMEDOUT while uploading layer');
    expect(r.kind).toBe('transient');
  });

  it('flags unclassified failures instead of guessing', () => {
    const r = classifyDeploymentFailure('', 'something weird happened');
    expect(r.kind).toBe('unknown');
  });
});

describe('monitoring policies', () => {
  it('low-cost policy checks less often than fast policy', () => {
    expect(checkIntervalFor('low_cost')).toBeGreaterThan(checkIntervalFor('fast'));
    expect(MONITOR_POLICIES.low_cost.consecutiveFailuresForIncident).toBeGreaterThan(MONITOR_POLICIES.fast.consecutiveFailuresForIncident);
  });

  it('falls back to balanced for unknown policy strings', () => {
    expect(policyFor('bogus')).toEqual(MONITOR_POLICIES.balanced);
  });
});

describe('secret redaction', () => {
  it('redacts key=value secrets in env-style content', () => {
    const out = redactString('JWT_SECRET=super-secret-value-here\nPORT=3000');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('super-secret-value-here');
    expect(out).toContain('PORT=3000'); // non-secret lines untouched
  });

  it('redacts structured objects by key name', () => {
    const out = redactValue({ API_KEY: 'abc123', name: 'orders', nested: { password: 'hunter2' } });
    expect(out.API_KEY).toBe('[REDACTED]');
    expect(out.name).toBe('orders');
    expect((out.nested as { password: string }).password).toBe('[REDACTED]');
  });

  it('redacts tokens and connection strings in free text', () => {
    const text = 'token ghp_AbCdEfGhIjKlMnOpQrStUvWx1234567890 and postgres://admin:s3cret@db.host:5432/app';
    const out = redactString(text);
    expect(out).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWx');
    expect(out).not.toContain('s3cret');
    expect(out).toContain('[REDACTED]');
  });

  it('never captures env VALUES from .env.example files', () => {
    const names = extractEnvVarNames('DATABASE_URL=\nJWT_SECRET=abc123  # not stored\nPORT=3000');
    expect(names).toEqual([
      { name: 'DATABASE_URL', required: true },
      { name: 'JWT_SECRET', required: false },
      { name: 'PORT', required: false },
    ]);
    expect(JSON.stringify(names)).not.toContain('abc123');
  });

  it('bounds and redacts log text', () => {
    const out = boundAndRedact('PASSWORD=hunter2 ' + 'x'.repeat(9000), 100);
    expect(out.length).toBeLessThan(200);
    expect(out).toContain('[REDACTED]');
  });
});

describe('command validation (no arbitrary shell)', () => {
  it('builds a validated deploy command from a template', () => {
    const cmd = buildValidatedCommand('liara_deploy', {
      app: 'orders-api',
      path: '.',
      token_ref: 'env:LIARA_API_TOKEN',
    });
    expect(cmd.argv[0]).toBe('liara');
    expect(cmd.argv).toContain('deploy');
    expect(isConsequential('liara_deploy')).toBe(true);
  });

  it('rejects shell injection in any argument', () => {
    expect(() => buildValidatedCommand('liara_deploy', { app: 'orders; rm -rf /', path: '.', token_ref: 'env:LIARA_API_TOKEN' })).toThrow(CommandValidationError);
    expect(() => buildValidatedCommand('liara_app_logs', { app: 'x', token_ref: 'env:LIARA_API_TOKEN && cat /etc/passwd' })).toThrow(CommandValidationError);
  });

  it('rejects unknown templates and invalid names', () => {
    // @ts-expect-error intentional unknown template
    expect(() => buildValidatedCommand('hack_the_planet', {})).toThrow(CommandValidationError);
    expect(() => buildValidatedCommand('liara_deploy', { app: 'Bad_Name!', path: '.', token_ref: 'env:LIARA_API_TOKEN' })).toThrow(CommandValidationError);
    expect(() => buildValidatedCommand('liara_app_restart', { app: '../etc', token_ref: 'env:LIARA_API_TOKEN' })).toThrow(CommandValidationError);
  });

  it('rejects raw secret values as token references (refs only)', () => {
    expect(() => buildValidatedCommand('liara_app_restart', { app: 'orders-api', token_ref: 'sk-live-abc123realvalue' })).toThrow(CommandValidationError);
    expect(() => buildValidatedCommand('liara_app_restart', { app: 'orders-api', token_ref: 'conn:abc123' })).not.toThrow();
  });

  it('keeps env VALUES off the command line (stdin only)', () => {
    const cmd = buildValidatedCommand('liara_env_set', { env_key: 'DATABASE_URL', app: 'orders-api', token_ref: 'env:LIARA_API_TOKEN' }, 'postgres://u:p@host/db');
    expect(cmd.argv.join(' ')).not.toContain('postgres://');
    expect(cmd.stdin?.envValue).toBe('postgres://u:p@host/db');
  });

  it('every consequential template requires approval by policy mapping', () => {
    for (const [id, t] of Object.entries(COMMAND_TEMPLATES)) {
      if (t.risk === 'consequential') {
        expect(isConsequential(id as never)).toBe(true);
      }
    }
  });
});

describe('plan hash binding', () => {
  it('binds approvals to the exact plan; changes invalidate them', () => {
    const plan = { method: 'liara_cli_deploy', commitSha: 'abc' };
    const h1 = planHashFor(plan);
    const h2 = planHashFor(plan);
    const h3 = planHashFor({ ...plan, commitSha: 'def' });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('liara app naming', () => {
  it('produces valid liara app ids from repo names', () => {
    expect(projectNameForLiara('My Org', 'Orders.API')).toMatch(/^[a-z0-9-]+$/);
    expect(projectNameForLiara('a'.repeat(60), 'x').length).toBeLessThanOrEqual(30);
  });
});
