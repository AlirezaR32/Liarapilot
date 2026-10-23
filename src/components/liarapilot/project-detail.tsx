'use client';

// Project detail: what did the agent discover (profile + evidence), what has
// it done (plans/executions), what can I do next (action buttons).
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type ProjectDetail as Detail } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { EvidenceList, KeyVal, LogBlock, StatusBadge, timeAgo } from './status-bits';
import { RunProgressCard } from './run-progress';
import { Check, ChevronDown, Copy, ExternalLink, Eye, GitBranch, Play, RefreshCw, Rocket, Settings2, ShieldCheck, Terminal } from 'lucide-react';
import { toast } from 'sonner';

/** The REAL final link — https://<app>.liara.run (Liara's free default domain). */
function AppLinkBanner({ appName }: { appName: string }) {
  const { t } = useI18n();
  const url = `https://${appName}.liara.run`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('Link copied'));
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t('failed'));
    }
  };
  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/30 p-4">
      <div aria-hidden className="absolute inset-0 -z-10 liara-gradient opacity-[0.08]" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
            <Rocket className="h-3.5 w-3.5" /> {t('Your app is live on Liara')}
          </p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate font-mono text-base font-bold text-foreground hover:text-primary"
            dir="ltr"
          >
            {url}
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10" onClick={() => void copy()}>
            {copied ? <Check className="me-1.5 h-3.5 w-3.5" /> : <Copy className="me-1.5 h-3.5 w-3.5" />}
            {t('Copy link')}
          </Button>
          <Button size="sm" className="liara-gradient liara-glow font-semibold text-[#0b1512]" onClick={() => window.open(url, '_blank', 'noopener')}>
            <ExternalLink className="me-1.5 h-3.5 w-3.5 text-[#0b1512]" />
            {t('Open app')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProjectDetail({ detail, onChanged, onOpenIncident, onOpenApprovals }: { detail: Detail; onChanged: () => void; onOpenIncident: (id: string) => void; onOpenApprovals: () => void }) {
  const { t } = useI18n();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const p = detail.project;

  const requestDeploy = async () => {
    setBusy('deploy');
    try {
      const res = await api.requestDeploy(p.id);
      setActiveRunId(res.runId);
      toast.success(t('Deployment pipeline started — it will pause at the approval gate'));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(null);
    }
  };

  const reanalyze = async () => {
    setBusy('analyze');
    try {
      await api.reanalyze(p.id);
      toast.success(t('Fresh analysis complete (bypassed cache)'));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(null);
    }
  };

  const setPolicy = async (policy: string) => {
    try {
      await api.updateMonitor(p.id, policy, undefined);
      toast.success(t('Monitoring policy set to {policy}', { policy }));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('failed'));
    }
  };

  const setHealthUrl = async (raw: string) => {
    try {
      await api.updateMonitor(p.id, undefined, undefined, raw);
      toast.success(t('Health URL saved — the agent now probes it on schedule'));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('failed'));
    }
  };

  const latestRun = detail.runs[0];
  const appLive = Boolean(p.liaraAppName && p.deployedSha);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{p.name}</h2>
            <Badge variant="outline" className="font-mono text-[10px]">
              <GitBranch className="me-1 h-3 w-3" />
              <span dir="ltr">{p.repoBranch}</span>
            </Badge>
          </div>
          <p className="font-mono text-xs text-muted-foreground" dir="ltr">
            {p.repoOwner}/{p.repoName}
            {p.deployedSha ? ` · @ ${p.deployedSha.slice(0, 7)}` : ` · ${t('never deployed')}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={reanalyze} disabled={busy === 'analyze'}>
            <RefreshCw className={`me-1.5 h-3.5 w-3.5 ${busy === 'analyze' ? 'animate-spin' : ''}`} /> {t('Re-analyze')}
          </Button>
          <Button size="sm" onClick={requestDeploy} disabled={busy === 'deploy'} className="bg-primary hover:bg-primary/90">
            <Rocket className="me-1.5 h-3.5 w-3.5" /> {t('Request deployment')}
          </Button>
        </div>
      </div>

      {/* The final link — what every deploy is for */}
      {appLive && p.liaraAppName && <AppLinkBanner appName={p.liaraAppName} />}

      {latestRun?.status === 'awaiting_approval' && !activeRunId && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-200">{t('Deployment needs your approval')}</p>
            <p className="mt-0.5 text-xs text-amber-300/90">{t('The pipeline paused at the approval gate — review the plan and approve to continue.')}</p>
          </div>
          <Button size="sm" className="shrink-0 bg-amber-500 hover:bg-amber-600" onClick={onOpenApprovals}>
            <ShieldCheck className="me-1.5 h-3.5 w-3.5" /> {t('Go to approvals')}
          </Button>
        </div>
      )}

      {activeRunId && (
        <RunProgressCard
          runId={activeRunId}
          title={t('Workflow progress (live)')}
          onComplete={(status) => {
            if (['succeeded', 'failed'].includes(status)) {
              onChanged();
            }
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* What did the agent discover? */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Eye className="h-4 w-4 text-muted-foreground/80" /> {t('What the agent discovered')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detail.profile ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-4">
                  <KeyVal k={t('Language')} v={detail.profile.language} />
                  <KeyVal k={t('Framework')} v={detail.profile.framework} />
                  <KeyVal k={t('Package manager')} v={detail.profile.packageManager} />
                  <KeyVal k={t('Node version')} v={detail.profile.languageVersion} />
                  <KeyVal k={t('Build')} v={detail.profile.buildCommand} />
                  <KeyVal k={t('Start')} v={detail.profile.startCommand} />
                  <KeyVal k={t('Port')} v={detail.profile.appPort ? String(detail.profile.appPort) : null} />
                  <KeyVal k={t('Dockerfile')} v={detail.profile.hasDockerfile ? t('yes') : t('no')} />
                </div>
                {detail.profile.requiredEnvVars.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-foreground/90">{t('Required env vars (names only — values never read)')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.profile.requiredEnvVars.map((v) => (
                        <Badge key={v.name} variant="outline" className={v.required ? 'border-amber-400/30 bg-amber-400/10 font-mono text-amber-300' : 'border-border font-mono text-muted-foreground'}>
                          <span dir="ltr">{v.name}</span>{v.required ? ' *' : ''}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground/80">{t('* required (empty value in .env.example)')}</p>
                  </div>
                )}
                {detail.profile.blockers.length > 0 && (
                  <div className="rounded-md border border-amber-400/25 bg-amber-400/10 p-2.5 text-xs text-amber-300">
                    <strong>{t('Blockers:')}</strong> {detail.profile.blockers.join(' · ')}
                  </div>
                )}
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary">
                    <ChevronDown className="h-3.5 w-3.5" /> {t('Evidence ({n}) — progressive disclosure', { n: detail.profile.evidence.length })}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <EvidenceList evidence={detail.profile.evidence} />
                    {detail.profile.readmeSummary && (
                      <>
                        <p className="mb-1 mt-3 text-xs font-medium text-foreground/90">{t('README excerpt (untrusted content, never executed)')}</p>
                        <LogBlock lines={detail.profile.readmeSummary.split('\n')} />
                      </>
                    )}
                  </CollapsibleContent>
                </Collapsible>
                <p className="text-[11px] text-muted-foreground/80">
                  {t('Analyzed {time} @ {sha}', { time: timeAgo(detail.profile.analyzedAt), sha: detail.profile.analyzedSha?.slice(0, 7) ?? '—' })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('No analysis yet — connect triggers it automatically.')}</p>
            )}
          </CardContent>
        </Card>

        {/* Recent activity for this project */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Terminal className="h-4 w-4 text-muted-foreground/80" /> {t('Plans & executions')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.plans.length === 0 && detail.executions.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('No plans yet. Request a deployment to generate one.')}</p>
            )}
            {detail.plans.slice(0, 3).map((pl) => {
              const plan = pl.plan as Record<string, unknown>;
              return (
                <div key={pl.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">
                      {t('Plan {sha} · {method}', { sha: pl.commitSha.slice(0, 7), method: String(plan.method ?? '') })}
                    </p>
                    <StatusBadge status={pl.status} />
                  </div>
                  {Array.isArray(plan.risks) && (plan.risks as string[]).length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{t('Risks: {risk}', { risk: (plan.risks as string[])[0] })}</p>
                  )}
                  {Array.isArray(plan.missingEnvVarNames) && (plan.missingEnvVarNames as string[]).length > 0 && (
                    <p className="mt-1 text-[11px] text-amber-300">{t('Missing env: {vars}', { vars: (plan.missingEnvVarNames as string[]).join(', ') })}</p>
                  )}
                </div>
              );
            })}
            {detail.executions.map((ex) => {
              const result = ex.result as { mode?: string; commandPreview?: string; stdoutTail?: string; stderrTail?: string } | null;
              const failed = ex.status === 'failed';
              return (
                <Collapsible key={ex.id}>
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        <span dir="ltr">{ex.method}</span> <span className="font-mono text-muted-foreground" dir="ltr">@ {ex.commitSha.slice(0, 7)}</span>
                        {result?.mode === 'mock' && <Badge variant="outline" className="ms-2 border-amber-400/30 bg-amber-400/10 text-[10px] text-amber-300">{t('mock execution')}</Badge>}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {timeAgo(ex.createdAt)} · {t('attempts: {n} · exit: {code}', { n: ex.attempts, code: ex.exitCode ?? '—' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={ex.status} />
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 px-2">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </div>
                  <CollapsibleContent className="pt-2">
                    {result?.commandPreview && <p className="mb-1 font-mono text-[11px] text-muted-foreground" dir="ltr">$ {result.commandPreview}</p>}
                    {result?.stderrTail && failed && (
                      <div dir="ltr" className="mb-1 rounded-md border border-red-400/30 bg-red-500/10 p-2 text-left text-[11px] text-red-300">{result.stderrTail.slice(-600)}</div>
                    )}
                    <LogBlock lines={(result?.stdoutTail ?? '').split('\n').slice(-8)} />
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Monitoring & demo controls */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 className="h-4 w-4 text-muted-foreground/80" /> {t('Monitoring')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('Monitoring policy')}</Label>
            <Select value={p.monitorPolicy} onValueChange={setPolicy}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low_cost">{t('low-cost (5 min interval, fewer investigations)')}</SelectItem>
                <SelectItem value="balanced">{t('balanced (1 min interval)')}</SelectItem>
                <SelectItem value="fast">{t('fast detection (30s interval, higher cost)')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground/80">{t('Trade-off: slower detection = fewer LLM/probe calls.')}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('Health URL (public)')}</Label>
            <div className="flex gap-1.5">
              <Input
                dir="ltr"
                defaultValue={p.healthUrl ?? ''}
                placeholder="https://your-app.liara.run/health"
                className="h-8 text-xs"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (p.healthUrl ?? '')) void setHealthUrl(v);
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground/80">{t('The URL the agent probes every cycle for availability & incidents.')}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('Open incidents')}</Label>
            {detail.incidents.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('None — service healthy.')}</p>
            ) : (
              <div className="space-y-1.5">
                {detail.incidents.slice(0, 4).map((i) => (
                  <button key={i.id} onClick={() => onOpenIncident(i.id)} className="flex w-full items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-start text-xs hover:bg-background">
                    <span className="truncate text-foreground/90">{i.title}</span>
                    <StatusBadge status={i.status} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Past runs */}
      {latestRun && !activeRunId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t('Latest workflow')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {latestRun.report && (
              <div className={`rounded-md border p-3 text-sm ${latestRun.report.outcome === 'success' ? 'border-primary/30 bg-primary/10 text-primary' : latestRun.report.outcome === 'failure' ? 'border-red-400/30 bg-red-500/10 text-red-300' : 'border-border bg-background text-foreground'}`}>
                <p className="font-medium">{latestRun.report.headline}</p>
                <p className="mt-0.5 text-xs opacity-90">{latestRun.report.detail}</p>
                {latestRun.report.nextSteps.length > 0 && (
                  <ul className="mt-1.5 list-disc ps-4 text-xs opacity-90">
                    {latestRun.report.nextSteps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span><span dir="ltr">{latestRun.kind}</span> · {t('trigger')}: {latestRun.trigger} · {timeAgo(latestRun.createdAt)}</span>
              <StatusBadge status={latestRun.status} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
        <Play className="h-3 w-3" /> {t('Health history: {up}/{total} checks up (last 40)', { up: detail.healthChecks.filter((c) => c.status === 'up').length, total: detail.healthChecks.length })}
      </div>
    </div>
  );
}
