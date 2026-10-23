// Deployment pipeline graph (spec §7):
// discovery → analysis → infra state → assessment → planning → policy
// → approval gate (interrupt) → execution → verification → reporting.
// Explicit nodes, deterministic routing, durable checkpointing, safe stops.

import { END, interrupt, START, StateGraph } from '@langchain/langgraph';
import { DeployState, emitEvent, setRunStage, type DeployStateType } from './state';
import { fetchRepoMetadata } from '@/lib/integrations/github/client';
import { liaraConnectionToken, gitConnectionToken } from '@/lib/security/credentials';
import { getProfileCached, projectNameForLiara } from '@/lib/services/projects';
import { listApps, listReleases, createApp } from '@/lib/integrations/liara/apiClient';
import { classifyRisk } from './policies';
import { persistPlan } from '@/lib/services/deployments';
import { planHashFor, createApproval, validateApprovalForExecution, markApprovalExecuted } from '@/lib/services/approvals';
import { audit } from '@/lib/services/audit';
import { runLiaraCommand, type CliRunResult } from '@/lib/integrations/liara/cliAdapter';
import { prepareRepoSource, expectedSourceRoot } from '@/lib/integrations/repoArchive';
import { classifyDeploymentFailure, shouldRetryDeployment, policyFor } from './policies';
import { performHttpCheck } from '@/lib/services/monitoring';
import { db } from '@/lib/db';
import { checkpointSaver } from '@/lib/persistence/checkpoints';
import type { DeploymentPlanData } from '@/lib/types';

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

async function repositoryDiscovery(s: DeployStateType): Promise<Partial<DeployStateType>> {
  await setRunStage(s.runId, 'repository_discovery', 'running');
  await emitEvent(s.runId, 'repository_discovery', 'خواندن اطلاعات مخزن و آخرین کامیت');
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  if (!project) throw new Error(`project ${s.projectId} not found`);

  const provider = project.repoProvider === 'gitlab' ? 'gitlab' : 'github';
  const { token, instanceUrl } = await gitConnectionToken(project.userId, provider);
  const meta = provider === 'gitlab'
    ? await (async () => {
        const { fetchRepoMetadata: glMeta } = await import('@/lib/integrations/gitlab/client');
        return glMeta({ owner: project.repoOwner, repo: project.repoName }, instanceUrl ?? 'https://gitlab.com', token);
      })()
    : await fetchRepoMetadata({ owner: project.repoOwner, repo: project.repoName }, token);
  const commit = await db.project.update({ where: { id: project.id }, data: { defaultBranch: meta.defaultBranch } });
  await emitEvent(s.runId, 'repository_discovery', `مخزن ${meta.fullName} (شاخهٔ پیش‌فرض: ${meta.defaultBranch})`);
  void commit;
  const latest = provider === 'gitlab'
    ? await (async () => {
        const { fetchLatestCommit: glCommit } = await import('@/lib/integrations/gitlab/client');
        return glCommit({ owner: project.repoOwner, repo: project.repoName }, instanceUrl ?? 'https://gitlab.com', token, meta.defaultBranch);
      })()
    : await (async () => {
        const { fetchLatestCommit } = await import('@/lib/integrations/github/client');
        return fetchLatestCommit({ owner: project.repoOwner, repo: project.repoName, branch: meta.defaultBranch }, token);
      })();
  return {
    repoMeta: { fullName: meta.fullName, defaultBranch: meta.defaultBranch, description: meta.description, pushedAt: meta.pushedAt },
    commitSha: latest?.sha ?? null,
  };
}

async function repositoryAnalysis(s: DeployStateType): Promise<Partial<DeployStateType>> {
  await setRunStage(s.runId, 'repository_analysis', 'running');
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  if (!project) throw new Error('project missing');
  await emitEvent(s.runId, 'repository_analysis', 'تحلیل پیکربندی پروژه (خواندن هدفمند فایل‌ها)');
  const { profile, fromCache } = await getProfileCached(project, {});
  await emitEvent(
    s.runId,
    'repository_analysis',
    `تشخیص: ${profile.language ?? 'زبان نامشخص'}${profile.framework ? ` / ${profile.framework}` : ''} — اجرا: ${profile.startCommand ?? 'مشخص نشد'}`,
    'info',
    { fromCache, blockers: profile.blockers, evidenceCount: profile.evidence.length },
  );
  if (fromCache) {
    await emitEvent(s.runId, 'repository_analysis', 'پروفایل برای این revision از کش سرو شد (کنترل هزینه)', 'info');
  }
  return { profile, profileFromCache: fromCache };
}

async function infrastructureState(s: DeployStateType): Promise<Partial<DeployStateType>> {
  await setRunStage(s.runId, 'infrastructure_state', 'running');
  await emitEvent(s.runId, 'infrastructure_state', 'بررسی وضعیت فعلی زیرساخت لیارا');
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  if (!project) throw new Error('project missing');

  const liaraToken = await liaraConnectionToken(project.userId);
  if (!liaraToken) {
    await emitEvent(s.runId, 'infrastructure_state', 'اتصال لیارا برقرار نیست — وضعیت زیرساخت از API لیارا خوانده نمی‌شود. توکن را در «تنظیمات ← اتصال لیارا» وارد کنید.', 'warn');
    return { infraState: { apps: [], source: 'not_connected', checkedAt: new Date().toISOString() } };
  }

  try {
    const apps = await listApps(liaraToken);
    await emitEvent(s.runId, 'infrastructure_state', `API لیارا ${apps.length} اپلیکیشن گزارش کرد`);
    return {
      infraState: {
        apps: apps.map((a) => ({ name: a.name, status: a.status, platform: a.type, isDeployed: a.isDeployed })),
        source: 'api',
        checkedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emitEvent(s.runId, 'infrastructure_state', `API لیارا در دسترس نیست: ${msg}`, 'warn');
    return { infraState: { apps: [], source: 'unavailable', checkedAt: new Date().toISOString() } };
  }
}

async function assessment(s: DeployStateType): Promise<Partial<DeployStateType>> {
  await setRunStage(s.runId, 'assessment', 'running');
  await emitEvent(s.runId, 'assessment', 'ارزیابی آمادگی استقرار بر اساس شواهد');
  const profile = s.profile;
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  if (!profile || !project) throw new Error('analysis missing');

  const notes: string[] = [];
  const appName = project.liaraAppName ?? projectNameForLiara(project.repoOwner, project.repoName);
  const existing = s.infraState?.apps.find((a) => a.name === appName);
  if (existing) notes.push(`اپلیکیشن «${appName}» از قبل روی لیارا وجود دارد (وضعیت: ${existing.status ?? 'نامشخص'}).`);
  else notes.push(`اپلیکیشنی به نام «${appName}» روی لیارا پیدا نشد — اولین استقرارِ تأییدشده آن را می‌سازد.`);

  if (project.deployedSha && project.deployedSha === s.commitSha) {
    notes.push('نسخهٔ مستقرشده با آخرین نسخهٔ مخزن یکسان است — انحرافی دیده نشد.');
  } else if (project.deployedSha) {
    notes.push(`نسخهٔ مستقرشده (${project.deployedSha.slice(0, 7)}) با HEAD مخزن (${s.commitSha?.slice(0, 7) ?? 'نامشخص'}) تفاوت دارد.`);
  }

  const ready = profile.isDeployable && profile.blockers.length === 0;
  if (!ready) {
    for (const b of profile.blockers) notes.push(`مانع: ${b}`);
  }
  await emitEvent(s.runId, 'assessment', ready ? 'پروژه با شواهد فعلی آمادهٔ استقرار است' : 'استقرار به‌خاطر پیکربندی ناقص مسدود است', ready ? 'info' : 'warn', { notes });

  return { assessmentResult: { deployed: Boolean(existing), drift: Boolean(project.deployedSha && project.deployedSha !== s.commitSha), ready, notes } };
}

async function actionPlanning(s: DeployStateType): Promise<Partial<DeployStateType>> {
  await setRunStage(s.runId, 'action_planning', 'running');
  await emitEvent(s.runId, 'action_planning', 'آماده‌سازی برنامهٔ استقرار');
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  const profile = s.profile;
  if (!project || !profile || !s.assessmentResult) throw new Error('state missing for planning');

  const candidate = profile.deploymentCandidates[0];
  const missingEnv = profile.requiredEnvVars.filter((v) => v.required).map((v) => v.name);

  const plan: DeploymentPlanData = {
    detectedFramework: profile.framework,
    runtime: profile.language ? `${profile.language}${profile.languageVersion ? ` ${profile.languageVersion}` : ''}` : null,
    method: candidate.method,
    platform: candidate.platform,
    buildConfig: profile.buildCommand,
    startConfig: profile.startCommand,
    requiredEnvVarNames: profile.requiredEnvVars.map((v) => v.name),
    missingEnvVarNames: missingEnv,
    liaraServiceType: 'PaaS app',
    resourceSuggestion: null, // only with verified pricing evidence — none in MVP
    costEstimate: null, // never invented (spec §8)
    blockers: profile.blockers.filter((b) => !b.includes('start command')),
    expectedEffects: [
      `اپلیکیشن لیارای «${project.liaraAppName ?? projectNameForLiara(project.repoOwner, project.repoName)}» را با revision ${s.commitSha?.slice(0, 7) ?? 'HEAD'} می‌سازد/به‌روزرسانی می‌کند.`,
      'بیلد روی لیارا اجرا می‌شود؛ بعد از بیلد موفق، ترافیک اپ به نسخهٔ جدید سوییچ می‌شود.',
    ],
    risks: [
      'نسخهٔ جدید جای نسخهٔ در حال اجرا را می‌گیرد؛ بیلد بد باعث شکست کوتاه استقرار می‌شود (نسخهٔ قبلی فعال می‌ماند).',
      ...(missingEnv.length ? [`متغیرهای محیطی الزامیِ غایب احتمالاً اپ را موقع راه‌اندازی crash می‌کنند: ${missingEnv.join(', ')}`] : []),
    ],
    rollback: 'نسخهٔ قبلی تا آماده‌شدن نسخهٔ جدید فعال می‌ماند؛ rollback یعنی استقرار دوبارهٔ revision قبلی (با دروازهٔ تأیید).',
    requiresApproval: true,
    approvalReasons: [],
    commitSha: s.commitSha,
  };

  const risk = classifyRisk('deploy_production', { isProduction: true });
  plan.requiresApproval = risk.requiresApproval;
  plan.approvalReasons = risk.reasons;

  const { planId, planHash } = await persistPlan({ projectId: project.id, runId: s.runId, commitSha: s.commitSha, plan });
  await emitEvent(s.runId, 'action_planning', `برنامه آماده شد (${plan.method}، پلتفرم: ${plan.platform ?? '—'}) — طبق سیاست تأیید لازم است`, 'info', {
    planHash,
    missingEnv,
  });

  let approvalId: string | null = null;
  if (risk.requiresApproval) {
    const approval = await createApproval({
      projectId: project.id,
      userId: s.userId,
      planId,
      runId: s.runId,
      actionType: 'deploy_production',
      targetRef: `liara:app:${project.liaraAppName ?? projectNameForLiara(project.repoOwner, project.repoName)}`,
      title: `استقرار ${profile.framework ?? profile.language ?? 'اپلیکیشن'} روی لیارا (${s.commitSha?.slice(0, 7) ?? 'HEAD'})`,
      rationale: `برنامهٔ مبتنی بر شواهد: ${candidate.rationale}`,
      evidence: { profile: { language: profile.language, framework: profile.framework, start: profile.startCommand, port: profile.appPort }, notes: s.assessmentResult.notes },
      risks: {
        reversible: risk.reversible,
        reasons: risk.reasons,
        risk: risk.risk,
        failureEffects: 'اگر استقرار شکست بخورد، نسخهٔ قبلی فعال می‌ماند؛ انتظار فقدان داده نمی‌رود.',
      },
      planHash,
      payload: {
        templateId: 'liara_deploy',
        args: {
          app: project.liaraAppName ?? projectNameForLiara(project.repoOwner, project.repoName),
          // the USER'S repo snapshot at this exact revision (downloaded at execution time)
          path: expectedSourceRoot(project.userId, project.repoName, s.commitSha),
          token_ref: `conn:${project.userId}`,
        },
        commitSha: s.commitSha,
      },
    });
    approvalId = approval.id;
  }

  return { plan, planId, planHash, risk, approvalId };
}

async function policyValidation(s: DeployStateType): Promise<Partial<DeployStateType>> {
  await setRunStage(s.runId, 'policy_validation', 'running');
  await emitEvent(s.runId, 'policy_validation', 'اعتبارسنجی عملیات با موتور سیاست');
  if (!s.plan || !s.risk) throw new Error('plan missing before policy validation');
  if (s.plan.blockers.length > 0 && !s.plan.missingEnvVarNames.length) {
    await emitEvent(s.runId, 'policy_validation', `برنامه مانع‌های حل‌نشده دارد: ${s.plan.blockers.join('; ')}`, 'warn');
  }
  await audit('policy.validated', { userId: s.userId, projectId: s.projectId, detail: { actionType: 'deploy_production', risk: s.risk.risk, requiresApproval: s.risk.requiresApproval } });
  return {};
}

async function approvalGate(s: DeployStateType): Promise<Partial<DeployStateType>> {
  if (!s.approvalId) {
    await emitEvent(s.runId, 'approval_gate', 'طبق سیاست تأییدی لازم نیست — ادامه می‌دهیم', 'info');
    return { approvalDecision: { approved: true, decidedBy: 'policy' } };
  }
  await setRunStage(s.runId, 'awaiting_approval', 'awaiting_approval');
  await emitEvent(s.runId, 'approval_gate', 'متوقف شد: منتظر تأیید انسانی (وضعیت گردش‌کار ماندگار است)', 'warn', { approvalId: s.approvalId });

  // Interrupt — durable pause. Resumes when the user decides via the API,
  // which calls graph.invoke(new Command({ resume }), same thread).
  const decision = interrupt({ approvalId: s.approvalId, actionType: 'deploy_production' }) as { approved: boolean; decidedBy: string; note?: string };

  await emitEvent(s.runId, 'approval_gate', decision.approved ? 'تأیید شد توسط کاربر — رفتن به مرحلهٔ اجرا' : 'توسط کاربر رد شد — هیچ استقراری انجام نمی‌شود', decision.approved ? 'info' : 'warn');
  return { approvalDecision: decision };
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Throttled live build-log emitter: batches CLI output lines into workflow
 *  events so the progress card shows the REAL build as it happens (bounded). */
function createLogEmitter(runId: string, node = 'execution', maxEvents = 24) {
  let buf: string[] = [];
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dropped = false;
  const flush = async () => {
    timer = null;
    if (!buf.length) return;
    const lines = buf.splice(0, 10).map((l) => `› ${l.slice(0, 160)}`);
    count += 1;
    await emitEvent(runId, node, lines.join('\n'), 'info');
    if (count >= maxEvents && !dropped) {
      dropped = true;
      await emitEvent(runId, node, '› … نمایش لاگ زنده به سقف رسید — خروجی کامل در رکورد اجرا موجود است', 'info');
    }
  };
  return {
    push(line: string) {
      if (count >= maxEvents) return;
      const t = line.replace(ANSI_RE, '').replace(/\r/g, '').trim();
      if (!t) return;
      buf.push(t);
      if (!timer) timer = setTimeout(() => void flush(), 2200);
    },
    async flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      await flush();
    },
  };
}

/** Map the analysis profile to a liara.json platform value (docs.liara.ir/paas/liarajson). */
function detectPlatform(profile: { hasDockerfile: boolean; language: string | null; framework: string | null }): string | null {
  if (profile.hasDockerfile) return 'docker';
  const lang = (profile.language ?? '').toLowerCase();
  const fw = (profile.framework ?? '').toLowerCase();
  const hay = `${lang} ${fw}`;
  if (/python|django|flask/.test(hay)) return 'python';
  if (/php|laravel/.test(hay)) return 'php';
  if (/\.net|dotnet|c#/.test(hay)) return 'dotnet';
  if (/static|html|vanilla/.test(hay) && !/node|express|next/.test(hay)) return 'static';
  if (/node|next|react|vue|angular|express|typescript|javascript|nuxt|nest/.test(hay)) return 'node';
  if (lang) return 'node'; // generic JS-dominant default is the common case
  return null;
}

/** Cheapest plan via the read-only `liara plan list --output json` template. */
async function pickCheapestPlan(userId: string): Promise<{ planID: string; source: 'cli' | 'fallback' }> {
  try {
    const res = await runLiaraCommand({
      templateId: 'liara_plan_list',
      args: { token_ref: `conn:${userId}` },
      context: { appName: 'plan-lookup', projectPath: process.cwd() },
      timeoutMs: 30_000,
      outputCap: 40_000,
    });
    if (res.ok && res.stdout.includes('[')) {
      const start = res.stdout.indexOf('[');
      const end = res.stdout.lastIndexOf(']');
      const parsed = JSON.parse(res.stdout.slice(start, end + 1)) as Array<Record<string, unknown>>;
      const plans = Array.isArray(parsed) ? parsed : [];
      const scored = plans
        .map((p) => ({
          id: String(p.planID ?? p.plan_id ?? p.slug ?? p.id ?? ''),
          price: Number(p.price ?? p.monthlyPrice ?? p.monthly_price ?? Number.POSITIVE_INFINITY),
          name: String(p.name ?? ''),
        }))
        .filter((p) => /^[a-z0-9][a-z0-9-]*$/i.test(p.id) && Number.isFinite(p.price))
        .sort((a, b) => a.price - b.price);
      if (scored[0]) return { planID: scored[0].id, source: 'cli' };
    }
  } catch {
    /* fall through to fallback */
  }
  return { planID: 'g1', source: 'fallback' };
}

async function execution(s: DeployStateType): Promise<Partial<DeployStateType>> {
  await setRunStage(s.runId, 'execution', 'running');
  const project = await db.project.findUnique({ where: { id: s.projectId } });
  if (!project || !s.planId || !s.planHash) throw new Error('execution state incomplete');
  if (!s.approvalDecision?.approved) throw new Error('execution reached without approval');

  // Re-validate approval immediately before executing (spec §10)
  const check = await validateApprovalForExecution(s.approvalId!, s.planHash);
  if (!check.ok) {
    await emitEvent(s.runId, 'execution', `اعتبارسنجی مجدد تأیید شکست خورد: ${check.reason}`, 'error');
    return { error: `approval invalid: ${check.reason}` };
  }

  const provider = project.repoProvider === 'gitlab' ? 'gitlab' : 'github';
  const appName = project.liaraAppName ?? projectNameForLiara(project.repoOwner, project.repoName);
  const liaraToken = await liaraConnectionToken(project.userId);
  if (!liaraToken) {
    await emitEvent(s.runId, 'execution', 'اتصال لیارا برقرار نیست — اجرای واقعی متوقف شد', 'error');
    await markApprovalExecuted(s.approvalId!, false);
    return { error: 'liara not connected' };
  }

  // ── 1. Snapshot the USER'S repo at the approved revision (their token) ──
  let source: { dir: string; bytes: number };
  try {
    const { token, instanceUrl } = await gitConnectionToken(project.userId, provider);
    source = await prepareRepoSource({
      userId: project.userId,
      provider,
      owner: project.repoOwner,
      repo: project.repoName,
      ref: s.commitSha ?? project.repoBranch,
      token,
      instanceUrl,
      onProgress: (m) => emitEvent(s.runId, 'execution', m),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emitEvent(s.runId, 'execution', msg, 'error');
    await markApprovalExecuted(s.approvalId!, false);
    return {
      executionResult: { ok: false, method: 'liara_cli_deploy', exitCode: null, mode: 'real', logs: [msg] },
      error: `دانلود سورس مخزن ناموفق بود: ${msg}`,
    };
  }
  await emitEvent(s.runId, 'execution', `سورس مخزن آماده شد — استقرار از پوشهٔ ${project.repoName}@${(s.commitSha ?? 'head').slice(0, 7)}`);

  // ── 2. liara.json hint when the repo has none (prevents interactive prompts) ──
  const platform = detectPlatform(s.profile ?? { hasDockerfile: false, language: null, framework: null });
  if (platform === null) {
    const msg = 'پلتفرم اپ از شواهد مخزن تشخیص داده نشد — یک Dockerfile یا liara.json به مخزن اضافه کنید و دوباره تلاش کنید';
    await emitEvent(s.runId, 'execution', msg, 'error');
    await markApprovalExecuted(s.approvalId!, false);
    return {
      executionResult: { ok: false, method: 'liara_cli_deploy', exitCode: null, mode: 'real', logs: [msg] },
      error: 'platform undetectable — repo needs a Dockerfile or liara.json',
    };
  }
  try {
    const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import('fs');
    const ljPath = `${source.dir}/liara.json`;
    if (!existsSync(ljPath) && platform !== 'docker') {
      mkdirSync(source.dir, { recursive: true });
      writeFileSync(ljPath, JSON.stringify({ platform }, null, 2));
      await emitEvent(s.runId, 'execution', `liara.json در مخزن نبود — یک فایل کمینه با پلتفرم «${platform}» کنار سورس نوشته شد`);
    } else if (existsSync(ljPath)) {
      try {
        const userLj = JSON.parse(readFileSync(ljPath, 'utf8')) as { platform?: string; port?: number };
        await emitEvent(s.runId, 'execution', `liara.json پروژه استفاده می‌شود (پلتفرم: ${userLj.platform ?? '—'}، پورت: ${userLj.port ?? 'پیش‌فرض'})`);
      } catch {
        await emitEvent(s.runId, 'execution', 'liara.json پروژه قابل خواندن نبود — همان فایل به لیارا داده می‌شود', 'warn');
      }
    }
  } catch {
    /* non-fatal */
  }

  // ── 3. Ensure the Liara app exists (verified API — part of the approved plan) ──
  let appsKnown: Array<{ name: string }> = [];
  try {
    appsKnown = await listApps(liaraToken);
  } catch (e) {
    await emitEvent(s.runId, 'execution', `فهرست اپ‌های لیارا خوانده نشد: ${e instanceof Error ? e.message : String(e)} — ادامه می‌دهیم`, 'warn');
  }
  if (appsKnown.length > 0 && !appsKnown.some((a) => a.name === appName)) {
    const plan = await pickCheapestPlan(project.userId);
    await emitEvent(
      s.runId,
      'execution',
      `اپلیکیشن «${appName}» روی لیارا وجود ندارد — طبق برنامهٔ تأییدشده ساخته می‌شود (پلن: ${plan.planID}${plan.source === 'fallback' ? '، پیش‌فرض' : '، ارزان‌ترین'} · پلتفرم: ${platform})`,
    );
    try {
      await createApp(appName, plan.planID, platform, liaraToken);
      await emitEvent(s.runId, 'execution', `اپلیکیشن «${appName}» روی لیارا ساخته شد`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await emitEvent(s.runId, 'execution', `ساخت اپلیکیشن ناموفق بود: ${msg}`, 'error');
      await markApprovalExecuted(s.approvalId!, false);
      return {
        executionResult: { ok: false, method: 'liara_cli_deploy', exitCode: null, mode: 'real', logs: [msg] },
        error: `app creation failed: ${msg}`,
      };
    }
    if (!project.liaraAppName) {
      await db.project.update({ where: { id: project.id }, data: { liaraAppName: appName } });
    }
  }

  // ── 4. Real deploy of the USER'S source dir via the validated CLI template ──
  const attempt = async (): Promise<{ result: CliRunResult & { validationError?: string }; executionId: string }> => {
    const { createExecution, startExecution, finalizeExecution } = await import('@/lib/services/deployments');
    const { id } = await createExecution({
      planId: s.planId!,
      projectId: project.id,
      commitSha: s.commitSha,
      method: 'liara_cli_deploy',
      idempotencyKey: `deploy:${project.id}:${s.commitSha ?? 'unknown'}`,
    });
    await startExecution(id);
    const logs = createLogEmitter(s.runId);
    const result = await runLiaraCommand({
      templateId: 'liara_deploy',
      args: { app: appName, path: source.dir, token_ref: `conn:${project.userId}` },
      context: { appName, projectPath: source.dir },
      tokenValue: liaraToken,
      timeoutMs: 900_000,
      outputCap: 80_000,
      onOutput: (chunk) => chunk.split(/\r?\n/).forEach((l) => logs.push(l)),
    });
    await logs.flush();
    await finalizeExecution(id, {
      ok: result.ok,
      exitCode: result.exitCode,
      stage: result.ok ? 'verify' : 'build',
      result: { commandPreview: result.commandPreview, mode: result.mode, stdoutTail: result.stdout.slice(-2000), stderrTail: result.stderr.slice(-2000), sourceBytes: source.bytes },
    });
    return { result, executionId: id };
  };

  let { result } = await attempt();
  if (result.validationError) {
    await emitEvent(s.runId, 'execution', `فرمان توسط اعتبارسنج رد شد: ${result.validationError}`, 'error');
    await markApprovalExecuted(s.approvalId!, false);
    return { error: `command validation failed: ${result.validationError}` };
  }

  if (!result.ok) {
    const failure = classifyDeploymentFailure(result.stderr, result.stdout);
    await emitEvent(s.runId, 'execution', `استقرار در مرحلهٔ ${failure.stage} شکست خورد: ${failure.evidence.join(' ')}`, 'error', { logs: [...failure.evidence] });
    const policy = policyFor(project.monitorPolicy);
    const retry = shouldRetryDeployment(1, failure.kind, policy.maxAutoRetries);
    if (retry.retry) {
      await emitEvent(s.runId, 'execution', `یک تلاش دوباره (${retry.reason})`, 'warn');
      const second = await attempt();
      result = second.result;
    } else {
      await emitEvent(s.runId, 'execution', `تلاش دوباره نمی‌کنیم: ${retry.reason}`, 'warn');
      await markApprovalExecuted(s.approvalId!, false);
      return {
        executionResult: { ok: false, method: 'liara_cli_deploy', exitCode: result.exitCode, mode: result.mode, logs: [...result.stdout.split('\n').slice(-3), ...result.stderr.split('\n').slice(-3)] },
        error: `deployment failed (${failure.stage}): ${failure.evidence.join(' ')}`,
      };
    }
  }

  await markApprovalExecuted(s.approvalId!, result.ok);
  const release = /Release (v\d+)/.exec(result.stdout)?.[1];

  // ── 5. Success bookkeeping: app name + the REAL final link ──
  const appUrl = `https://${appName}.liara.run`;
  if (result.ok) {
    await db.project.update({
      where: { id: project.id },
      data: { liaraAppName: appName, ...(project.healthUrl ? {} : { healthUrl: appUrl }) },
    });
    await emitEvent(s.runId, 'execution', `استقرار تمام شد — لینک اپلیکیشن شما: ${appUrl}`, 'success', { appUrl });
  }
  return {
    executionResult: { ok: result.ok, method: 'liara_cli_deploy', exitCode: result.exitCode, mode: result.mode, release, appUrl, logs: result.stdout.split('\n').slice(-5) },
  };
}

async function postActionVerification(s: DeployStateType): Promise<Partial<DeployStateType>> {
  await setRunStage(s.runId, 'post_action_verification', 'verifying');
  await emitEvent(s.runId, 'post_action_verification', 'راستی‌آزمایی سرویس مستقرشده (بدون شواهد هرگز موفقیت ادعا نمی‌شود)');

  const project = await db.project.findUnique({ where: { id: s.projectId } });
  if (!project) throw new Error('project missing');

  const details: string[] = [];
  let ok = false;

  // 1. Platform evidence when available (releases endpoint + user's token)
  if (project.liaraAppName) {
    try {
      const rel = await listReleases(project.liaraAppName, await liaraConnectionToken(project.userId) ?? '');
      details.push(`لیارا نسخهٔ فعلی را گزارش می‌کند: ${rel.currentRelease ?? 'نامشخص'}، ${rel.releases.length} نسخه.`);
      ok = rel.releases.some((r) => r.state === 'ready' || r.state === 'running');
    } catch (e) {
      details.push(`endpoint نسخه‌ها در دسترس نیست: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 2. External HTTP health check (identical code path for mock targets)
  const { healthTargetUrl } = await import('@/lib/services/monitoring');
  const url = healthTargetUrl(project);
  const check = url ? await performHttpCheck(url) : { ok: false, status: 'down' as const, httpStatus: null, latencyMs: null, error: 'no health URL configured' };
  details.push(`پروب HTTP ${check.status.toUpperCase()}${check.httpStatus ? ` (${check.httpStatus})` : ''} در ${check.latencyMs ?? '?'}ms`);
  ok = ok || check.ok;

  if (check.ok && s.executionResult?.ok) {
    await db.project.update({ where: { id: project.id }, data: { deployedSha: s.commitSha } });
  }

  await emitEvent(s.runId, 'post_action_verification', ok ? 'راستی‌آزمایی موفق بود' : 'راستی‌آزمایی شکست خورد — صادقانه گزارش می‌کنیم', ok ? 'success' : 'error', { details });
  return { verification: { ok, method: 'http_probe+releases', details, at: new Date().toISOString() } };
}

async function reporting(s: DeployStateType): Promise<Partial<DeployStateType>> {
  await setRunStage(s.runId, 'reporting', 'running');

  if (s.error) {
    const report = {
      headline: 'استقرار شکست خورد',
      detail: s.error,
      nextSteps: [
        'شواهد شکست را در لاگ اجرا بررسی کنید.',
        'اصلاح پیشنهادی را اعمال کنید، سپس استقرار جدید بخواهید (برنامه و تأیید جدید ساخته می‌شود).',
      ],
      outcome: 'failure' as const,
    };
    await db.workflowRun.update({ where: { id: s.runId }, data: { status: 'failed', reportJson: JSON.stringify(report), finishedAt: new Date() } });
    return { report };
  }

  if (s.approvalDecision && !s.approvalDecision.approved) {
    const report = {
      headline: 'استقرار توسط کاربر رد شد',
      detail: 'هیچ اقدام زیرساختی انجام نشد. برنامه برای مرور نگه داشته شد.',
      nextSteps: ['هر وقت آماده بودید از صفحهٔ پروژه دوباره استقرار را درخواست کنید.'],
      outcome: 'rejected' as const,
    };
    await db.workflowRun.update({ where: { id: s.runId }, data: { status: 'succeeded', reportJson: JSON.stringify(report), finishedAt: new Date() } });
    return { report };
  }

  const verified = s.verification?.ok ?? false;
  const proj = await db.project.findUnique({ where: { id: s.projectId } });
  const appUrl = s.executionResult?.appUrl ?? (proj?.liaraAppName ? `https://${proj.liaraAppName}.liara.run` : null);
  const report = {
    headline: verified ? 'استقرار کامل شد و راستی‌آزمایی شد' : 'استقرار اجرا شد اما راستی‌آزمایی شکست خورد',
    detail: verified
      ? `نسخهٔ ${s.executionResult?.release ?? 'نامشخص'} در حال سرو است (پروب HTTP موفق).${appUrl ? ` لینک اپلیکیشن: ${appUrl}` : ''}`
      : 'فرمان استقرار تمام شد اما سرویس آن‌طور که انتظار می‌رفت پاسخ نداد — جزئیات راستی‌آزمایی را ببینید.',
    nextSteps: verified
      ? [...(appUrl ? [`اپلیکیشن را باز کنید: ${appUrl}`] : []), 'پایش سرویس (خودکار).', 'جزئیات نسخه را در صفحهٔ پروژه ببینید.']
      : ['لاگ‌های اپ و پیکربندی متغیرهای محیطی را بررسی کنید.', 'اگر اپ متغیر محیطی لازم دارد، از جریان اصلاح پیشنهادی استفاده کنید.'],
    outcome: verified ? ('success' as const) : ('failure' as const),
  };
  await db.workflowRun.update({ where: { id: s.runId }, data: { status: 'succeeded', reportJson: JSON.stringify(report), finishedAt: new Date() } });
  return { report };
}

// ---------------------------------------------------------------------------
// Graph assembly (singleton)
// ---------------------------------------------------------------------------

let deployGraphSingleton: ReturnType<typeof buildDeployGraph> | null = null;

function buildDeployGraph() {
  const g = new StateGraph(DeployState)
    .addNode('repository_discovery', repositoryDiscovery)
    .addNode('repository_analysis', repositoryAnalysis)
    .addNode('infrastructure_state', infrastructureState)
    .addNode('assessment', assessment)
    .addNode('action_planning', actionPlanning)
    .addNode('policy_validation', policyValidation)
    .addNode('approval_gate', approvalGate)
    .addNode('execution', execution)
    .addNode('post_action_verification', postActionVerification)
    .addNode('reporting', reporting)
    .addEdge(START, 'repository_discovery')
    .addEdge('repository_discovery', 'repository_analysis')
    .addEdge('repository_analysis', 'infrastructure_state')
    .addEdge('infrastructure_state', 'assessment')
    .addEdge('assessment', 'action_planning')
    .addEdge('action_planning', 'policy_validation')
    .addEdge('policy_validation', 'approval_gate')
    .addConditionalEdges('approval_gate', (s: DeployStateType) =>
      s.approvalDecision?.approved ? 'execution' : 'reporting',
    )
    .addConditionalEdges('execution', (s: DeployStateType) => {
      if (s.error) return 'reporting';
      return s.executionResult?.ok ? 'post_action_verification' : 'reporting';
    })
    .addEdge('post_action_verification', 'reporting')
    .addEdge('reporting', END);

  return g.compile({ checkpointer: checkpointSaver() });
}

export function getDeployGraph() {
  if (!deployGraphSingleton) deployGraphSingleton = buildDeployGraph();
  return deployGraphSingleton;
}

export type { DeployStateType };
