// Incident investigation graph (spec §9 Layers 3-5):
// bounded evidence → intelligent diagnosis → remediation planning
// → approval gate (interrupt) → safe remediation → verification → report.
// The LLM is ONLY invoked here (on-demand), never in the monitoring loop.

import { END, interrupt, START, StateGraph } from '@langchain/langgraph';
import { InvestigateState, emitEvent, setRunStage, type InvestigateStateType } from './state';
import { db } from '@/lib/db';
import { EvidencePackage, Diagnosis, type EvidencePackage as EvidencePackageT } from '@/lib/types';
import { policyFor } from './policies';
import { classifyRisk } from './policies';
import { createApproval, validateApprovalForExecution, markApprovalExecuted } from '@/lib/services/approvals';
import { recordUsage } from '@/lib/services/audit';
import { runLiaraCommand } from '@/lib/integrations/liara/cliAdapter';
import { performHttpCheck, healthTargetUrl } from '@/lib/services/monitoring';
import { z } from 'zod';
import { checkpointSaver } from '@/lib/persistence/checkpoints';

// ---------------------------------------------------------------------------
// Evidence collection — deterministic, bounded, redacted (no LLM)
// ---------------------------------------------------------------------------

async function collectEvidence(s: InvestigateStateType): Promise<Partial<InvestigateStateType>> {
  await setRunStage(s.runId, 'collecting_evidence', 'running');
  await emitEvent(s.runId, 'collect_evidence', 'جمع‌آوری بستهٔ شواهد محدود و پاک‌سازی‌شده (بدون LLM)');

  const project = await db.project.findUnique({ where: { id: s.projectId } });
  const incident = await db.incident.findUnique({ where: { id: s.incidentId } });
  if (!project || !incident) throw new Error('project or incident missing');

  const checks = await db.healthCheck.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });

  const pkg: EvidencePackageT = {
    boundedAt: new Date().toISOString(),
    healthChecks: checks.map((c) => ({
      at: c.createdAt.toISOString(),
      status: c.status,
      httpStatus: c.httpStatus,
      latencyMs: c.latencyMs,
      error: c.error,
    })),
    serviceStatus: null, // enriched via verified endpoints when Liara is connected
    recentDeploys: [],
    recentLogs: [],
    recentCommits: [],
    resourceMetrics: null, // honest: not available in this integration scope
    configMetadata: {
      framework: null,
      healthUrl: project.healthUrl,
      monitorPolicy: project.monitorPolicy,
      deployedSha: project.deployedSha,
    },
    notes: [
      `Incident: ${incident.kind} — ${incident.title}`,
      'خواندن لاگ‌های پلتفرم به اتصال لیارا (توکن API) نیاز دارد.',
    ],
  };

  // recent deploys (executions) — bounded
  const execs = await db.deploymentExecution.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  pkg.recentDeploys = execs.map((e) => ({
    at: e.createdAt.toISOString(),
    method: e.method,
    status: e.status,
    commit: e.commitSha.slice(0, 7),
    exitCode: e.exitCode,
  }));

  // bounded platform logs ONLY via the verified API path + the user's own token
  if (project.liaraAppName) {
    try {
      const { getAppLogs } = await import('@/lib/integrations/liara/apiClient');
      const { liaraConnectionToken } = await import('@/lib/security/credentials');
      const token = await liaraConnectionToken(project.userId);
      if (!token) {
        pkg.notes.push('اتصال لیارا برقرار نیست — لاگ پلتفرمی در دسترس نیست.');
      } else {
        const since = new Date(Date.now() - 3600_000).toISOString();
        const logs = await getAppLogs(project.liaraAppName, since, token, 30);
        const { boundAndRedact } = await import('@/lib/security/redaction');
        pkg.recentLogs = logs.map((l) => boundAndRedact(`[${l.datetime}] ${l.message}`, 300));
      }
    } catch (e) {
      pkg.notes.push(`Platform logs unavailable: ${e instanceof Error ? e.message : e}`);
    }
  }

  // recent commits via the git provider (bounded, user's own token)
  try {
    const { fetchLatestCommit } = await import('@/lib/integrations/github/client');
    const { gitConnectionToken } = await import('@/lib/security/credentials');
    const provider = project.repoProvider === 'gitlab' ? 'gitlab' : 'github';
    const { token } = await gitConnectionToken(project.userId, provider);
    const c = await fetchLatestCommit({ owner: project.repoOwner, repo: project.repoName }, token);
    if (c) pkg.recentCommits = [`${c.sha.slice(0, 7)} ${c.message.slice(0, 80)}`];
  } catch {
    pkg.notes.push('Recent commits unavailable.');
  }

  await emitEvent(s.runId, 'collect_evidence', `بستهٔ شواهد: ${pkg.healthChecks.length} بررسی، ${pkg.recentLogs.length} خط لاگ، ${pkg.recentDeploys.length} استقرار`, 'info');
  return { evidence: pkg };
}

// ---------------------------------------------------------------------------
// Diagnosis — the ONLY LLM step (bounded, budgeted). Rule-based fallback.
// ---------------------------------------------------------------------------

const DiagnosisSchema = z.object({
  observedFacts: z.array(z.string()).max(8),
  probableCauses: z.array(z.object({ cause: z.string(), confidence: z.enum(['high', 'medium', 'low', 'unknown']), supportingEvidence: z.string() })).max(4),
  uncertainty: z.string(),
  recommendedNextSteps: z.array(z.string()).max(5),
  potentialImpact: z.string(),
  requiredPermissions: z.array(z.string()).max(4),
  proposedRemediation: z
    .object({
      kind: z.enum(['set_env', 'restart_app', 'code_patch', 'rollback', 'none']),
      title: z.string(),
      description: z.string(),
      diff: z.string().nullable(),
      requiresApproval: z.boolean(),
      reversible: z.boolean(),
    })
    .nullable(),
});

async function diagnose(s: InvestigateStateType): Promise<Partial<InvestigateStateType>> {
  await setRunStage(s.runId, 'diagnosing', 'investigating');
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  const incident = await db.incident.findUnique({ where: { id: s.incidentId } });
  if (!project || !incident || !s.evidence) throw new Error('state missing');

  await recordUsage('investigation', { projectId: project.id, userId: project.userId });

  // Budget guard: skip LLM entirely when the daily investigation budget is spent
  const { countInvestigationsToday } = await import('@/lib/services/monitoring');
  const used = await countInvestigationsToday(project.id, new Date());
  const policy = policyFor(project.monitorPolicy);
  if (used > policy.investigationBudgetPerDay) {
    await emitEvent(s.runId, 'diagnose', 'Investigation budget exhausted for today — using deterministic rules only', 'warn');
  }

  let diagnosis: z.infer<typeof DiagnosisSchema> | null = null;
  let source: 'llm' | 'rules' = 'rules';

  if (used <= policy.investigationBudgetPerDay) {
    const { structuredChat } = await import('@/lib/integrations/llm/adapter');
    const llm = await structuredChat(DiagnosisSchema, {
      userId: s.userId,
      system:
        'You are an SRE diagnosis engine. Use ONLY the provided evidence. Never invent metrics, logs, or endpoints. Distinguish observed facts from hypotheses. Prefer the smallest reversible remediation. Write ALL human-readable values (observedFacts, probableCauses[].cause, supportingEvidence, uncertainty, recommendedNextSteps, potentialImpact, proposedRemediation.title/description) in PERSIAN (Farsi). Keep technical terms, identifiers, env var names, commands and values in English.',
      label: 'incident_investigation',
      schemaHint: DiagnosisSchemadescription(),
      user: JSON.stringify({ incident: { kind: incident.kind, title: incident.title }, evidence: s.evidence }),
    });
    if (llm) {
      diagnosis = llm;
      source = 'llm';
      await emitEvent(s.runId, 'diagnose', 'LLM diagnosis generated (budgeted call)', 'info', { causes: llm.probableCauses.map((c) => c.cause) });
    }
  }

  if (!diagnosis) {
    // deterministic fallback: pattern-match evidence (no fabricated intelligence)
    const facts = s.evidence.healthChecks.filter((c) => c.status !== 'up');
    const has5xx = facts.some((c) => (c.httpStatus ?? 0) >= 500);
    const hasTimeout = facts.some((c) => c.error === 'timeout');
    const failedDeploy = s.evidence.recentDeploys.find((d) => d.status === 'failed');
    const causes: z.infer<typeof DiagnosisSchema>['probableCauses'] = [];
    if (has5xx) causes.push({ cause: 'Application errors (5xx) — likely unhandled exception or missing dependency/config at runtime', confidence: 'medium', supportingEvidence: 'Consecutive HTTP 5xx responses in health-check history' });
    if (hasTimeout) causes.push({ cause: 'Process not accepting connections (crash loop or resource exhaustion)', confidence: 'low', supportingEvidence: 'Probe timeouts recorded' });
    if (failedDeploy) causes.push({ cause: `Recent failed deployment (commit ${failedDeploy.commit}) may have broken the service`, confidence: 'medium', supportingEvidence: 'Failed deployment execution in history' });
    diagnosis = {
      observedFacts: [
        `${facts.length} failed health checks in the bounded window`,
        ...(has5xx ? ['HTTP 5xx responses observed'] : []),
        ...(failedDeploy ? [`Failed deployment at ${failedDeploy.at}`] : []),
      ],
      probableCauses: causes.length ? causes : [{ cause: 'Undetermined from available evidence', confidence: 'unknown', supportingEvidence: 'Insufficient data' }],
      uncertainty: 'Root cause cannot be proven without application logs; correlation is not causation.',
      recommendedNextSteps: ['Review recent deployment', 'Inspect application logs via `liara app logs` (requires token)', 'Verify required environment variables'],
      potentialImpact: has5xx ? 'User-facing errors on affected endpoints' : 'Service availability degraded',
      requiredPermissions: ['read logs', 'restart app (approval required)'],
      proposedRemediation:
        failedDeploy || has5xx
          ? {
              kind: 'restart_app',
              title: 'ری‌استارت اپلیکیشن برای پاک‌کردن وضعیت خراب احتمالی زمان اجرا',
              description: 'ری‌استارت بازگشت‌پذیر است اما سرویس را کوتاه قطع می‌کند؛ طبق سیاست تأیید شما لازم است.',
              diff: null,
              requiresApproval: true,
              reversible: true,
            }
          : null,
    };
    await emitEvent(s.runId, 'diagnose', 'Deterministic diagnosis generated (LLM unavailable or out of budget)', 'warn');
  }

  await db.incident.update({
    where: { id: s.incidentId },
    data: { status: 'awaiting_approval', diagnosisJson: JSON.stringify(diagnosis) },
  });
  return { diagnosis, diagnosisSource: source };
}

function DiagnosisSchemadescription(): string {
  return `{
  "observedFacts": ["..."],
  "probableCauses": [{"cause": "...", "confidence": "high|medium|low|unknown", "supportingEvidence": "..."}],
  "uncertainty": "...",
  "recommendedNextSteps": ["..."],
  "potentialImpact": "...",
  "requiredPermissions": ["..."],
  "proposedRemediation": {"kind": "set_env|restart_app|code_patch|rollback|none", "title": "...", "description": "...", "diff": null, "requiresApproval": true, "reversible": true} | null
}`;
}

// ---------------------------------------------------------------------------
// Remediation planning: smallest reversible action; approval per policy
// ---------------------------------------------------------------------------

async function remediationPlanning(s: InvestigateStateType): Promise<Partial<InvestigateStateType>> {
  await setRunStage(s.runId, 'remediation_planning', 'running');
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  const incident = await db.incident.findUnique({ where: { id: s.incidentId } });
  if (!project || !incident || !s.diagnosis) throw new Error('state missing');

  const rem = s.diagnosis.proposedRemediation;
  if (!rem || rem.kind === 'none') {
    await emitEvent(s.runId, 'remediation_planning', 'No automated remediation proposed — evidence and next steps reported to user', 'info');
    await db.incident.update({ where: { id: s.incidentId }, data: { status: 'escalated', remediationJson: JSON.stringify({ kind: 'none' }) } });
    return {};
  }

  const actionType = rem.kind === 'restart_app' ? 'restart_app' : rem.kind === 'set_env' ? 'set_env' : rem.kind === 'rollback' ? 'rollback_deployment' : 'repo_write';
  const risk = classifyRisk(actionType as Parameters<typeof classifyRisk>[0], { isProduction: true });
  await db.incident.update({ where: { id: s.incidentId }, data: { remediationJson: JSON.stringify(rem) } });

  if (!risk.requiresApproval) {
    await emitEvent(s.runId, 'remediation_planning', `اصلاح «${rem.title}» طبق سیاست برای اجرای خودکار امن است`, 'info');
    return { approvalId: null };
  }

  const appName = project.liaraAppName ?? `${project.repoOwner}-${project.repoName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const approval = await createApproval({
    projectId: project.id,
    userId: s.userId,
    runId: s.runId,
    incidentId: s.incidentId,
    actionType,
    targetRef: `liara:app:${appName}`,
    title: rem.title,
    rationale: rem.description,
    evidence: { diagnosis: s.diagnosis.observedFacts, causes: s.diagnosis.probableCauses },
    risks: { reversible: rem.reversible, reasons: risk.reasons, risk: risk.risk, failureEffects: 'اگر ری‌استارت شکست بخورد، سرویس پایین می‌ماند؛ وضعیت پلتفرم را بررسی کنید.' },
    planHash: `remediation:${s.incidentId}:${rem.kind}`,
    payload: { templateId: actionType === 'restart_app' ? 'liara_app_restart' : actionType === 'set_env' ? 'liara_env_set' : null, args: { app: appName, token_ref: `conn:${project.userId}` }, remKind: rem.kind },
  });
  await emitEvent(s.runId, 'remediation_planning', `درخواست تأیید: ${rem.title}`, 'warn', { approvalId: approval.id });
  return { approvalId: approval.id };
}

async function remediationApprovalGate(s: InvestigateStateType): Promise<Partial<InvestigateStateType>> {
  if (!s.approvalId) {
    return { approvalDecision: { approved: true, decidedBy: 'policy' } };
  }
  await setRunStage(s.runId, 'awaiting_approval', 'awaiting_approval');
  const decision = interrupt({ approvalId: s.approvalId, actionType: 'remediation' }) as { approved: boolean; decidedBy: string; note?: string };
  await emitEvent(s.runId, 'remediation_approval_gate', decision.approved ? 'اصلاح تأیید شد' : 'اصلاح رد شد', decision.approved ? 'info' : 'warn');
  if (!decision.approved) {
    const incident = await db.incident.findUnique({ where: { id: s.incidentId } });
    if (incident) {
      await db.incident.update({ where: { id: s.incidentId }, data: { status: 'escalated' } });
    }
  }
  return { approvalDecision: decision };
}

async function applyRemediation(s: InvestigateStateType): Promise<Partial<InvestigateStateType>> {
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  const incident = await db.incident.findUnique({ where: { id: s.incidentId } });
  if (!project || !incident) throw new Error('state missing');

  const rem = s.diagnosis?.proposedRemediation;
  if (!rem || rem.kind === 'none' || (s.approvalDecision && !s.approvalDecision.approved)) {
    await emitEvent(s.runId, 'apply_remediation', 'هیچ چیز اعمال نشد (بدون اصلاح یا ردشده)', 'info');
    return { remediationResult: { applied: false, kind: 'none', detail: 'اصلاحی اعمال نشد.' } };
  }

  await setRunStage(s.runId, 'remediating', 'remediating');
  const appName = project.liaraAppName ?? `${project.repoOwner}-${project.repoName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Re-validate approval immediately before execution
  if (s.approvalId) {
    const check = await validateApprovalForExecution(s.approvalId, `remediation:${s.incidentId}:${rem.kind}`);
    if (!check.ok) {
      await emitEvent(s.runId, 'apply_remediation', `اعتبارسنجی تأیید نامعتبر است: ${check.reason}`, 'error');
      return { remediationResult: { applied: false, kind: rem.kind, detail: check.reason } };
    }
  }

  if (rem.kind === 'restart_app') {
    const { liaraConnectionToken } = await import('@/lib/security/credentials');
    const tokenValue = await liaraConnectionToken(project.userId);
    const result = await runLiaraCommand({
      templateId: 'liara_app_restart',
      args: { app: appName, token_ref: `conn:${project.userId}` },
      context: { appName, projectPath: process.cwd() },
      tokenValue: tokenValue ?? undefined,
    });
    if (s.approvalId) await markApprovalExecuted(s.approvalId, result.ok);
    await db.incident.update({ where: { id: s.incidentId }, data: { status: 'verifying' } });
    await emitEvent(s.runId, 'apply_remediation', `فرمان ری‌استارت ${result.ok ? 'پذیرفته شد' : 'شکست خورد'} (حالت ${result.mode})`, result.ok ? 'info' : 'error', { preview: result.commandPreview });
    return { remediationResult: { applied: result.ok, kind: 'restart_app', detail: result.ok ? `${appName} ری‌استارت شد (حالت ${result.mode})` : result.stderr.slice(0, 300) } };
  }

  if (rem.kind === 'set_env') {
    const m = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/.exec(rem.description);
    if (!m) {
      await emitEvent(s.runId, 'apply_remediation', 'اصلاح محیطی رد شد: توضیح باید به شکل KEY=value باشد', 'error');
      return { remediationResult: { applied: false, kind: 'set_env', detail: 'no KEY=value in remediation description' } };
    }
    const { liaraConnectionToken } = await import('@/lib/security/credentials');
    const tokenValue = await liaraConnectionToken(project.userId);
    const result = await runLiaraCommand({
      templateId: 'liara_env_set',
      args: { app: appName, env_key: m[1], token_ref: `conn:${project.userId}` },
      envValue: m[2],
      context: { appName, projectPath: process.cwd() },
      tokenValue: tokenValue ?? undefined,
    });
    if (s.approvalId) await markApprovalExecuted(s.approvalId, result.ok);
    await db.incident.update({ where: { id: s.incidentId }, data: { status: 'verifying' } });
    return { remediationResult: { applied: result.ok, kind: 'set_env', detail: result.ok ? `${m[1]} روی ${appName} تنظیم شد` : result.stderr.slice(0, 300) } };
  }

  // code_patch / rollback are proposal-only in this MVP (never auto-applied)
  await emitEvent(s.runId, 'apply_remediation', `نوع اصلاح «${rem.kind}» در این نسخه فقط-پیشنهادی است — برای اقدام دستی به شما نمایش داده می‌شود`, 'warn');
  return { remediationResult: { applied: false, kind: rem.kind, detail: 'فقط پیشنهاد — به‌صورت دستی با diff ارائه‌شده اعمال کنید.' } };
}

async function verifyRemediation(s: InvestigateStateType): Promise<Partial<InvestigateStateType>> {
  await setRunStage(s.runId, 'post_remediation_verification', 'verifying');
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  if (!project) throw new Error('project missing');

  await emitEvent(s.runId, 'verify_remediation', 'بررسی دوبارهٔ سرویس و مقایسه با وضعیت پایهٔ قبل از اقدام');

  const before = s.evidence?.healthChecks.filter((c) => c.status !== 'up').length ?? 0;
  const url = healthTargetUrl(project);
  if (!url) {
    await emitEvent(s.runId, 'verify_remediation', 'آدرس سلامت عمومی تنظیم نشده — راستی‌آزمایی HTTP انجام نشد', 'warn');
    return { remediationResult: { applied: Boolean(s.remediationResult?.applied), kind: s.remediationResult?.kind ?? 'none', detail: 'no health URL to verify' } };
  }
  const c1 = await performHttpCheck(url);
  await new Promise((r) => setTimeout(r, 500)); // brief settle
  const c2 = await performHttpCheck(url);

  const resolved = c1.ok && c2.ok;
  const details = [
    `شکست‌های وضعیت پایه: ${before}`,
    `پروب ۱: ${c1.status}${c1.httpStatus ? ` (${c1.httpStatus})` : ''}`,
    `پروب ۲: ${c2.status}${c2.httpStatus ? ` (${c2.httpStatus})` : ''}`,
  ];

  if (resolved) {
    await db.incident.update({
      where: { id: s.incidentId },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  } else {
    await db.incident.update({ where: { id: s.incidentId }, data: { status: 'escalated' } });
  }

  await emitEvent(s.runId, 'verify_remediation', resolved ? 'سرویس بهبود یافت — حادثه حل شد' : 'سرویس هنوز خراب است — توقف اصلاح خودکار (شواهد حفظ شد)', resolved ? 'success' : 'error', { details });
  return { verification: { resolved, details, at: new Date().toISOString() } };
}

async function reporting(s: InvestigateStateType): Promise<Partial<InvestigateStateType>> {
  await setRunStage(s.runId, 'reporting', 'running');
  const resolved = s.verification?.resolved ?? false;
  const report = {
    headline: resolved ? 'حادثه بعد از اصلاح حل شد' : 'حادثه به توجه انسانی نیاز دارد',
    detail: resolved
      ? `${s.diagnosis?.proposedRemediation?.title ?? 'اصلاح'} اعمال و با دو پروب سالم متوالی تأیید شد.`
      : s.remediationResult?.applied === false && s.remediationResult.kind !== 'none'
        ? 'اصلاح پیشنهاد شد اما اعمال نشد (بدون تأیید یا فقط-پیشنهاد). شواهد و گام‌های پیشنهادی به حادثه پیوست است.'
        : 'اصلاح خودکار مشکل را حل نکرد. بعد از راستی‌آزماییِ پیکربندی‌شده متوقف شدیم — بدون تلاش کورکورانه.',
    nextSteps: resolved
      ? ['پایش برای تکرار (خودکار).']
      : (s.diagnosis?.recommendedNextSteps ?? ['شواهد حادثه را بازبینی کنید.']),
  };
  await db.workflowRun.update({ where: { id: s.runId }, data: { status: 'succeeded', reportJson: JSON.stringify(report), finishedAt: new Date() } });
  return { report };
}

// ---------------------------------------------------------------------------
// Graph assembly
// ---------------------------------------------------------------------------

let investigateGraphSingleton: ReturnType<typeof buildInvestigateGraph> | null = null;

function buildInvestigateGraph() {
  const g = new StateGraph(InvestigateState)
    .addNode('collect_evidence', collectEvidence)
    .addNode('diagnose', diagnose)
    .addNode('remediation_planning', remediationPlanning)
    .addNode('remediation_approval_gate', remediationApprovalGate)
    .addNode('apply_remediation', applyRemediation)
    .addNode('verify_remediation', verifyRemediation)
    .addNode('reporting', reporting)
    .addEdge(START, 'collect_evidence')
    .addEdge('collect_evidence', 'diagnose')
    .addEdge('diagnose', 'remediation_planning')
    .addEdge('remediation_planning', 'remediation_approval_gate')
    .addConditionalEdges('remediation_approval_gate', (s: InvestigateStateType) =>
      s.approvalDecision?.approved && s.diagnosis?.proposedRemediation ? 'apply_remediation' : 'reporting',
    )
    .addEdge('apply_remediation', 'verify_remediation')
    .addEdge('verify_remediation', 'reporting')
    .addEdge('reporting', END);
  return g.compile({ checkpointer: checkpointSaver() });
}

export function getInvestigateGraph() {
  if (!investigateGraphSingleton) investigateGraphSingleton = buildInvestigateGraph();
  return investigateGraphSingleton;
}
