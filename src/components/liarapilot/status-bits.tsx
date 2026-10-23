'use client';

import { Badge } from '@/components/ui/badge';
import { translate, timeAgo } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  repository_discovery: 'Reading repository',
  repository_analysis: 'Analyzing configuration',
  infrastructure_state: 'Checking infrastructure',
  assessment: 'Assessing readiness',
  action_planning: 'Preparing plan',
  policy_validation: 'Validating policy',
  awaiting_approval: 'Waiting for your approval',
  execution: 'Executing operation',
  post_action_verification: 'Verifying service health',
  reporting: 'Preparing report',
  completed: 'Completed',
  failed: 'Failed',
  collecting_evidence: 'Collecting evidence',
  diagnosing: 'Investigating (LLM)',
  remediation_planning: 'Planning remediation',
  remediating: 'Applying remediation',
  post_remediation_verification: 'Verifying recovery',
  resuming: 'Resuming',
};

const STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-primary/15 text-primary border-primary/30',
  resolved: 'bg-primary/15 text-primary border-primary/30',
  up: 'bg-primary/15 text-primary border-primary/30',
  approved: 'bg-primary/15 text-primary border-primary/30',
  executed: 'bg-primary/15 text-primary border-primary/30',
  running: 'bg-amber-100 text-amber-900 border-amber-400/25',
  investigating: 'bg-amber-100 text-amber-900 border-amber-400/25',
  verifying: 'bg-amber-100 text-amber-900 border-amber-400/25',
  detected: 'bg-amber-100 text-amber-900 border-amber-400/25',
  awaiting_approval: 'bg-amber-100 text-amber-900 border-amber-400/25',
  pending: 'bg-amber-100 text-amber-900 border-amber-400/25',
  degraded: 'bg-amber-100 text-amber-900 border-amber-400/25',
  failed: 'bg-red-100 text-red-800 border-red-400/30',
  down: 'bg-red-100 text-red-800 border-red-400/30',
  rejected: 'bg-red-100 text-red-800 border-red-400/30',
  escalated: 'bg-red-100 text-red-800 border-red-400/30',
  http_5xx: 'bg-red-100 text-red-800 border-red-400/30',
  deployment_failed: 'bg-red-100 text-red-800 border-red-400/30',
  timeout: 'bg-red-100 text-red-800 border-red-400/30',
  unhealthy: 'bg-red-100 text-red-800 border-red-400/30',
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <Badge variant="outline" className="text-muted-foreground">—</Badge>;
  const style = STATUS_STYLES[status] ?? 'bg-muted text-foreground/90 border-border';
  return (
    <Badge variant="outline" className={cn(style, 'font-medium', className)}>
      {translate(status.replace(/_/g, ' '))}
    </Badge>
  );
}

export function StageLabel({ stage }: { stage: string | null | undefined }) {
  if (!stage) return <span className="text-muted-foreground text-sm">—</span>;
  const key = STAGE_LABELS[stage];
  return <span className="text-sm text-foreground/90">{key ? translate(key) : stage}</span>;
}

export function HealthDot({ status }: { status: string | null | undefined }) {
  const color = !status ? 'bg-muted-foreground/40' : status === 'up' ? 'bg-primary' : status === 'degraded' ? 'bg-amber-400' : 'bg-red-500';
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 rounded-full', color)}
      aria-label={translate('health: {status}', { status: status ?? '' })}
    />
  );
}

export function MockTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-amber-300 text-[10px] uppercase tracking-wide">
      {translate('demo/mock')}
    </Badge>
  );
}

export function RealTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px] uppercase tracking-wide">
      {translate('real mode')}
    </Badge>
  );
}

export function EvidenceList({ evidence }: { evidence: Array<{ file: string; field: string; detail: string }> }) {
  if (!evidence?.length) return <p className="text-sm text-muted-foreground">{translate('No evidence recorded.')}</p>;
  return (
    <ul className="space-y-1.5">
      {evidence.map((e, i) => (
        <li key={i} className="text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground" dir="ltr">{e.file}</code>{' '}
          <span className="font-medium text-foreground/90" dir="ltr">{e.field}</span> — {e.detail}
        </li>
      ))}
    </ul>
  );
}

export function LogBlock({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <pre dir="ltr" className={cn('max-h-64 overflow-y-auto rounded-md bg-zinc-950 p-3 text-left text-[11px] leading-relaxed text-zinc-100', className)}>
      {lines.join('\n') || translate('(no output)')}
    </pre>
  );
}

export function KeyVal({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span dir="auto" className="text-xs font-medium text-foreground text-end break-all">{v || '—'}</span>
    </div>
  );
}

export { timeAgo };
