'use client';

// Incident views: list + investigation detail (evidence → diagnosis →
// remediation → verification). Progressive disclosure everywhere.
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { api, type IncidentDetail, type IncidentSummary } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { StatusBadge, timeAgo } from './status-bits';
import { RunProgressCard } from './run-progress';
import { AlertTriangle, ChevronDown, FlaskConical, Search, ShieldQuestion, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';

export function IncidentsListView({ incidents, onOpen }: { incidents: IncidentSummary[]; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  if (incidents.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <ShieldQuestion className="h-8 w-8 text-muted-foreground/40" />
          <p className="font-medium text-foreground">{t('No incidents')}</p>
          <p className="text-sm text-muted-foreground">{t('The lightweight monitor (plain code, no LLM) keeps watching connected services.')}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {incidents.map((i) => (
        <button
          key={i.id}
          onClick={() => onOpen(i.id)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-start transition-colors hover:border-primary/40"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{i.title}</p>
            <p className="text-xs text-muted-foreground">
              {i.projectName} · <code dir="ltr">{i.kind}</code> · {t('first seen {first} · last {last}', { first: timeAgo(i.firstSeenAt), last: timeAgo(i.lastSeenAt) })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {i.hasDiagnosis && (
              <Badge variant="outline" className="border-teal-400/30 bg-teal-400/10 text-[10px] text-teal-300">
                <Stethoscope className="me-1 h-3 w-3" /> {t('diagnosed')}
              </Badge>
            )}
            {i.hasRemediation && (
              <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-[10px] text-amber-300">
                {t('remediation proposed')}
              </Badge>
            )}
            <StatusBadge status={i.status} />
          </div>
        </button>
      ))}
    </div>
  );
}

export function IncidentDetailView({ detail, onChanged, onOpenApprovals }: { detail: IncidentDetail; onChanged: () => void; onOpenApprovals: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(detail.incident.runId);
  const inc = detail.incident;

  const investigate = async () => {
    setBusy(true);
    try {
      const res = await api.investigateIncident(inc.id);
      setRunId(res.runId);
      toast.success(t('Investigation started — evidence is collected deterministically; the LLM is only invoked for diagnosis'));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  const diagnosis = inc.diagnosis as {
    observedFacts?: string[];
    probableCauses?: Array<{ cause: string; confidence: string; supportingEvidence: string }>;
    uncertainty?: string;
    recommendedNextSteps?: string[];
    potentialImpact?: string;
    proposedRemediation?: { kind: string; title: string; description: string; diff: string | null; requiresApproval: boolean } | null;
  } | null;

  const evidence = inc.evidence as {
    healthChecks?: Array<{ at: string; status: string; httpStatus: number | null; latencyMs: number | null; error: string | null }>;
    recentLogs?: string[];
    recentDeploys?: Array<Record<string, unknown>>;
    notes?: string[];
    boundedAt?: string;
  } | null;

  const remediation = inc.remediation as { kind: string; title?: string; description?: string; diff?: string | null; requiresApproval?: boolean } | null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <AlertTriangle className="h-5 w-5 text-red-500" /> {inc.title}
          </h2>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {inc.projectName} · <code dir="ltr">{inc.kind}</code> · <StatusBadge status={inc.status} />
          </p>
        </div>
        {['detected', 'escalated', 'resolved'].includes(inc.status) && (
          <Button size="sm" variant="outline" onClick={investigate} disabled={busy}>
            <Search className={`me-1.5 h-3.5 w-3.5 ${busy ? 'animate-pulse' : ''}`} /> {t('Run investigation')}
          </Button>
        )}
      </div>

      {runId && (
        <RunProgressCard
          runId={runId}
          title={t('Investigation progress (live)')}
          onComplete={(status) => {
            if (['succeeded', 'failed'].includes(status)) onChanged();
          }}
        />
      )}

      {inc.summary && <p className="rounded-md border border-border bg-background p-3 text-sm text-foreground/90">{inc.summary}</p>}

      {diagnosis && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Stethoscope className="h-4 w-4 text-teal-400" /> {t('Diagnosis (correlation is not causation)')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs font-medium text-foreground/90">{t('Observed facts')}</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-4 text-xs text-muted-foreground">
                {(diagnosis.observedFacts ?? []).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground/90">{t('Probable causes')}</p>
              <div className="mt-1 space-y-1.5">
                {(diagnosis.probableCauses ?? []).map((c, i) => (
                  <div key={i} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{c.cause}</span>
                      <Badge variant="outline" className="text-[10px]">{t('confidence: {c}', { c: c.confidence })}</Badge>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{c.supportingEvidence}</p>
                  </div>
                ))}
              </div>
            </div>
            {diagnosis.uncertainty && <p className="text-xs italic text-muted-foreground">{t('Uncertainty: {u}', { u: diagnosis.uncertainty })}</p>}
            {diagnosis.potentialImpact && <p className="text-xs text-muted-foreground">{t('Impact: {i}', { i: diagnosis.potentialImpact })}</p>}
          </CardContent>
        </Card>
      )}

      {remediation && (
        <Card className={remediation.requiresApproval !== false ? 'border-amber-400/25' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="h-4 w-4 text-amber-400" /> {t('Proposed remediation (smallest reversible action)')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-foreground">{remediation.title ?? remediation.kind}</p>
            <p className="text-sm text-muted-foreground">{remediation.description}</p>
            {remediation.diff && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-primary">
                  <ChevronDown className="h-3.5 w-3.5" /> {t('View proposed patch (diff — never auto-applied)')}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <pre dir="ltr" className="max-h-64 overflow-auto rounded-md bg-zinc-950 p-3 text-left text-[11px] text-emerald-200">{remediation.diff}</pre>
                </CollapsibleContent>
              </Collapsible>
            )}
            {remediation.requiresApproval !== false && inc.status !== 'resolved' && (
              <Button size="sm" onClick={onOpenApprovals} className="bg-primary hover:bg-primary/90">
                {t('Review pending approval')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t('Evidence package (bounded & redacted)')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {evidence?.notes?.map((n, i) => (
            <p key={i} className="text-xs text-muted-foreground">• {n}</p>
          ))}
          {evidence?.healthChecks && (
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-primary">
                <ChevronDown className="h-3.5 w-3.5" /> {t('Health checks ({n})', { n: evidence.healthChecks.length })}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="space-y-1">
                  {evidence.healthChecks.slice(0, 10).map((c, i) => (
                    <div key={i} className="flex items-center justify-between rounded border border-border px-2 py-1 text-[11px]">
                      <span className="text-muted-foreground">{timeAgo(c.at)}</span>
                      <span dir="ltr" className={c.status === 'up' ? 'text-primary' : 'text-red-400'}>
                        {c.status}
                        {c.httpStatus ? ` · ${c.httpStatus}` : ''}
                        {c.error ? ` · ${c.error}` : ''}
                        {c.latencyMs ? ` · ${c.latencyMs}ms` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
          {evidence?.recentLogs && evidence.recentLogs.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-primary">
                <ChevronDown className="h-3.5 w-3.5" /> {t('Log evidence (redacted, bounded)')}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <pre dir="ltr" className="max-h-56 overflow-auto rounded-md bg-zinc-950 p-3 text-left text-[11px] text-zinc-100">{evidence.recentLogs.join('\n')}</pre>
              </CollapsibleContent>
            </Collapsible>
          )}
          {evidence?.recentDeploys && evidence.recentDeploys.length > 0 && (
            <div>
              <p className="text-xs font-medium text-foreground/90">{t('Recent deployments')}</p>
              {evidence.recentDeploys.map((d, i) => (
                <p key={i} dir="ltr" className="text-left text-[11px] text-muted-foreground">
                  {String(d.at)} · {String(d.method)} · {String(d.status)} · {String(d.commit)}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
