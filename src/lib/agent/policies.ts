// Deterministic policy engine (spec §10): risk classification & approval
// boundaries. Conservative defaults; configurable, but never permissive by
// default. This module is pure — unit-tested without any I/O.

import type { RiskClassification } from '@/lib/types';

export type ActionType =
  | 'read_repository_files'
  | 'analyze_project'
  | 'static_checks'
  | 'http_health_check'
  | 'collect_logs'
  | 'prepare_deployment_plan'
  | 'propose_code_patch'
  | 'generate_diagnostic_report'
  | 'deploy_production'
  | 'create_app'
  | 'restart_app'
  | 'stop_app'
  | 'start_app'
  | 'change_plan'
  | 'set_env'
  | 'change_dns'
  | 'rollback_deployment'
  | 'repo_write'
  | 'delete_resource';

const SAFE: Record<string, string[]> = {
  read_repository_files: ['دسترسی فقط-خواندنی به محتوای مجاز مخزن.'],
  analyze_project: ['تحلیل ایستای فایل‌های مخزن؛ بدون اثر جانبی.'],
  static_checks: ['بررسی‌های ایستای محدود و ایزوله؛ بدون اثر جانبی.'],
  http_health_check: ['پروب HTTP خروجی به سرویسی که خودتان پیکربندی کرده‌اید؛ بدون تغییر وضعیت.'],
  collect_logs: ['دریافت محدود لاگ‌های مجاز و پاک‌سازی‌شده.'],
  prepare_deployment_plan: ['فقط ساخت سند برنامه؛ به زیرساخت دست نمی‌زند.'],
  propose_code_patch: ['تولید diff برای بازبینی شما؛ بدون نوشتن در مخزن.'],
  generate_diagnostic_report: ['تولید گزارش از شواهد جمع‌آوری‌شده.'],
};

// approval required by default (spec §10 list)
const APPROVAL_REQUIRED: Record<string, { reasons: string[]; reversible: boolean }> = {
  deploy_production: {
    reasons: ['کد جدید را روی سرویس پروداکشن مستقر می‌کند.', 'روی ترافیک زنده اثر می‌گذارد.'],
    reversible: true, // via previous release rollback, but still approval-gated
  },
  create_app: {
    reasons: ['منبع جدیدی (بالقوه هزینه‌دار) روی حساب لیارای شما می‌سازد.'],
    reversible: false,
  },
  restart_app: {
    reasons: ['سرویس پروداکشن را ری‌استارت می‌کند؛ قطعی کوتاه ممکن است.'],
    reversible: true,
  },
  stop_app: {
    reasons: ['سرویس پروداکشن را متوقف می‌کند؛ باعث قطعی می‌شود.'],
    reversible: true,
  },
  start_app: {
    reasons: ['سرویس را روشن می‌کند (ممکن است هزینه داشته باشد).'],
    reversible: true,
  },
  change_plan: {
    reasons: ['پلن یک منبع هزینه‌دار را تغییر می‌دهد.'],
    reversible: false,
  },
  set_env: {
    reasons: ['متغیرهای محیطی پروداکشن را تغییر می‌دهد؛ ممکن است اپ ری‌استارت شود.', 'یک مقدار اشتباه می‌تواند سرویس را از کار بیندازد.'],
    reversible: true,
  },
  change_dns: {
    reasons: ['پیکربندی DNS/دامنه را تغییر می‌دهد؛ برگرداندن انتشارش کُند است.'],
    reversible: false,
  },
  rollback_deployment: {
    reasons: ['یک استقرار پروداکشن را به نسخهٔ قبلی برمی‌گرداند.'],
    reversible: true,
  },
  repo_write: {
    reasons: ['در مخزن شما می‌نویسد یا pull request باز می‌کند.'],
    reversible: true,
  },
  delete_resource: {
    reasons: ['مخرب است و به‌سختی بازگشت‌پذیر.'],
    reversible: false,
  },
};

/**
 * Classify an action. Pure function of (actionType, context) — no LLM, no I/O.
 */
export function classifyRisk(
  actionType: ActionType,
  context: { isProduction?: boolean; involvesPaidResource?: boolean } = {},
): RiskClassification {
  if (SAFE[actionType]) {
    return {
      actionType,
      risk: 'low',
      requiresApproval: false,
      reasons: SAFE[actionType],
      reversible: true,
    };
  }

  const entry = APPROVAL_REQUIRED[actionType];
  if (entry) {
    const reasons = [...entry.reasons];
    let risk: RiskClassification['risk'] = 'medium';
    if (actionType === 'deploy_production') risk = context.isProduction === false ? 'medium' : 'high';
    if (actionType === 'delete_resource' || actionType === 'change_dns') risk = 'high';
    if (actionType === 'restart_app' || actionType === 'start_app' || actionType === 'stop_app') risk = context.isProduction === false ? 'low' : 'medium';
    if (context.involvesPaidResource) {
      reasons.push('شامل منابع هزینه‌دار است.');
      risk = 'high';
    }
    return {
      actionType,
      risk,
      requiresApproval: true,
      reasons,
      reversible: entry.reversible,
    };
  }

  // Unknown action types are treated as high risk — fail closed.
  return {
    actionType,
    risk: 'high',
    requiresApproval: true,
    reasons: [`نوع عملیات ناشناخته «${actionType}» — به‌صورت پیش‌فرض پرریسک در نظر گرفته می‌شود.`],
    reversible: false,
  };
}

/** Deployment approval is required for production targets, always by default. */
export function deploymentRequiresApproval(isProduction: boolean): boolean {
  return classifyRisk('deploy_production', { isProduction }).requiresApproval;
}

// ---------------------------------------------------------------------------
// Incident policy: thresholds, cooldowns, retry budgets (spec §9)
// ---------------------------------------------------------------------------

export interface MonitorPolicy {
  consecutiveFailuresForIncident: number;
  cooldownMinutes: number;
  incidentDedupWindowMinutes: number;
  maxAutoRetries: number;
  investigationBudgetPerDay: number;
}

export const MONITOR_POLICIES: Record<string, MonitorPolicy> = {
  low_cost: {
    consecutiveFailuresForIncident: 4,
    cooldownMinutes: 60,
    incidentDedupWindowMinutes: 60,
    maxAutoRetries: 1,
    investigationBudgetPerDay: 5,
  },
  balanced: {
    consecutiveFailuresForIncident: 3,
    cooldownMinutes: 30,
    incidentDedupWindowMinutes: 30,
    maxAutoRetries: 2,
    investigationBudgetPerDay: 10,
  },
  fast: {
    consecutiveFailuresForIncident: 2,
    cooldownMinutes: 10,
    incidentDedupWindowMinutes: 15,
    maxAutoRetries: 2,
    investigationBudgetPerDay: 20,
  },
};

export function policyFor(p: string | null | undefined): MonitorPolicy {
  return MONITOR_POLICIES[p ?? 'balanced'] ?? MONITOR_POLICIES.balanced;
}

/** Health-check interval per policy (seconds) — cost control. */
export function checkIntervalFor(policy: string | null | undefined, configured?: number | null): number {
  if (configured && configured >= 15) return configured;
  switch (policy) {
    case 'low_cost':
      return 300;
    case 'fast':
      return 30;
    default:
      return 60;
  }
}

/**
 * Whether a new failing check should OPEN or UPDATE an incident, and whether
 * the incident is still inside its cooldown (dedup — spec §9 Layer 2).
 */
export function evaluateFailureSignal(
  consecutiveFailures: number,
  policy: MonitorPolicy,
): { incident: boolean } {
  return { incident: consecutiveFailures >= policy.consecutiveFailuresForIncident };
}

/** Should the agent retry a failed deployment? Deterministic, bounded. */
export function shouldRetryDeployment(
  attempts: number,
  failureKind: 'transient' | 'deterministic' | 'unknown',
  maxAttempts: number,
): { retry: boolean; reason: string } {
  if (attempts >= maxAttempts) {
    return { retry: false, reason: `بودجهٔ تلاش تمام شد (${attempts}/${maxAttempts})` };
  }
  if (failureKind === 'deterministic') {
    return { retry: false, reason: 'شکست قطعی — تلاش دوباره با همان پیکربندی تغییرنکرده هدر دادن منابع است؛ اول باید مشکل رفع شود' };
  }
  if (failureKind === 'transient') return { retry: true, reason: 'شکست شبیه خطای گذرا است (شبکه/تایم‌اوت)؛ یک‌بار تلاش دوباره می‌کنیم' };
  return { retry: false, reason: 'کلاس شکست نامشخص — به‌جای تلاش کورکورانه به انسان ارجاع می‌شود' };
}

/** Classify a CLI deployment failure from its output (deterministic rules). */
export function classifyDeploymentFailure(stderr: string, stdout: string): {
  kind: 'transient' | 'deterministic' | 'unknown';
  stage: 'prepare' | 'build' | 'upload' | 'platform' | 'verify';
  evidence: string[];
} {
  const text = `${stdout}\n${stderr}`;
  const evidence: string[] = [];
  const push = (s: string) => {
    if (evidence.length < 6) evidence.push(s);
  };

  if (/error TS\d+|Build failed|Module not found|Cannot find module|npm ERR!/i.test(text)) {
    if (/Cannot find module ['"]\./.test(text) || /error TS\d+/i.test(text)) push('خطای کامپایل/ماژول در خروجی بیلد');
    push('شکست در مرحلهٔ بیلد — قطعی؛ قبل از تلاش دوباره کد/پیکربندی را رفع کنید.');
    return { kind: 'deterministic', stage: 'build', evidence };
  }
  if (/ECONNREFUSED|DATABASE_URL unset|Missing required environment|app crashed on startup/i.test(text)) {
    push('شکست زمان اجرا/راه‌اندازی که به پیکربندی گم‌شده اشاره دارد.');
    return { kind: 'deterministic', stage: 'platform', evidence };
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|429|rate limit|network/i.test(text)) {
    push('خطای شبیه شبکه — احتمالاً گذراست.');
    return { kind: 'transient', stage: 'upload', evidence };
  }
  push('شکست دسته‌بندی‌نشده.');
  return { kind: 'unknown', stage: 'platform', evidence };
}
