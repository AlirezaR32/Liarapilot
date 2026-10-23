'use client';

// Overview (spec §11): the first page = a live summary of EVERYTHING.
// Hero with an at-a-glance sentence, KPI chips, the latest agent events,
// then the familiar project grid and connect form.
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { api, type AuditEventDTO, type ProjectSummary } from '@/lib/client';
import { formatNumber, useI18n } from '@/lib/i18n';
import { HealthDot, StageLabel, StatusBadge, timeAgo } from './status-bits';
import { RunProgressInline } from './run-progress';
import {
  AlertTriangle, BarChart3, Bot, BookOpen, CheckCircle2, GitBranch, Github,
  Plug, Plus, RefreshCw, Rocket, ShieldCheck, Siren,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

function GitLabMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

// audit kind → icon + translated label
const EVENT_META: Record<string, { icon: typeof Rocket; key: string; cls: string }> = {
  'approval.requested': { icon: ShieldCheck, key: 'approval requested', cls: 'text-amber-300' },
  'approval.granted': { icon: CheckCircle2, key: 'approval granted', cls: 'text-primary' },
  'approval.denied': { icon: AlertTriangle, key: 'approval denied', cls: 'text-red-300' },
  'approval.expired': { icon: AlertTriangle, key: 'approval expired', cls: 'text-amber-300' },
  'execution.attempt': { icon: Rocket, key: 'execution started', cls: 'text-sky-300' },
  'execution.result': { icon: Rocket, key: 'execution finished', cls: 'text-sky-300' },
  'incident.opened': { icon: Siren, key: 'incident opened', cls: 'text-red-300' },
  'incident.resolved': { icon: CheckCircle2, key: 'incident resolved', cls: 'text-primary' },
  'policy.validated': { icon: ShieldCheck, key: 'policy validated', cls: 'text-primary' },
  'deploy.requested': { icon: Rocket, key: 'deploy requested', cls: 'text-sky-300' },
  'project.connected': { icon: Plug, key: 'repository connected', cls: 'text-primary' },
  'analysis.requested': { icon: Bot, key: 'analysis requested', cls: 'text-sky-300' },
  'connection.github.pat': { icon: Github, key: 'GitHub token connected', cls: 'text-primary' },
  'connection.gitlab.pat': { icon: GitBranch, key: 'GitLab token connected', cls: 'text-amber-300' },
  'connection.github.device_start': { icon: Github, key: 'GitHub browser login started', cls: 'text-sky-300' },
  'connection.github.device_done': { icon: Github, key: 'GitHub connected via browser', cls: 'text-primary' },
  'connection.gitlab.device_start': { icon: GitBranch, key: 'GitLab browser login started', cls: 'text-sky-300' },
  'connection.gitlab.device_done': { icon: GitBranch, key: 'GitLab connected via browser', cls: 'text-primary' },
  'connection.liara.token': { icon: Plug, key: 'Liara token connected', cls: 'text-primary' },
  'connection.liara.disconnect': { icon: Plug, key: 'Liara disconnected', cls: 'text-amber-300' },
  'connection.ai.saved': { icon: Bot, key: 'AI brain connected', cls: 'text-primary' },
  'connection.ai.disconnect': { icon: Bot, key: 'AI brain disconnected', cls: 'text-amber-300' },
  'settings.oauth_app.saved': { icon: ShieldCheck, key: 'OAuth app registered', cls: 'text-primary' },
};

export function Overview({
  projects,
  pendingApprovals,
  events,
  onChanged,
  onOpenProject,
  onOpenView,
}: {
  projects: ProjectSummary[];
  pendingApprovals: number;
  events: AuditEventDTO[];
  onChanged: () => void;
  onOpenProject: (id: string) => void;
  onOpenView: (v: 'dashboard' | 'activity' | 'guide' | 'settings' | 'approvals' | 'incidents' | 'repos') => void;
}) {
  const { t, locale } = useI18n();
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<'github' | 'gitlab'>('github');
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    if (!name.trim()) {
      toast.error(t('Repository name is required'));
      return;
    }
    setConnecting(true);
    try {
      const res = await api.connectProject({ owner: owner.trim(), name: name.trim(), provider });
      toast.success(t('Repository connected — analysis started automatically'));
      onChanged();
      onOpenProject(res.project.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('connect failed'));
    } finally {
      setConnecting(false);
    }
  };

  const attention = projects.flatMap((p) =>
    p.openIncidents.map((i) => ({ project: p, incident: i })),
  );

  const deployed = projects.filter((p) => p.deployedSha).length;
  const openIncidents = attention.length;
  const latestEvents = events.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* ── Hero: live summary of everything ─────────────────────────── */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/25 p-6 sm:p-7">
        <div aria-hidden className="absolute inset-0 -z-10 liara-gradient opacity-[0.07]" />
        <div aria-hidden className="absolute -left-16 -top-24 h-56 w-56 rounded-full bg-[#28c1f5]/10 blur-3xl" />
        <div aria-hidden className="absolute -bottom-24 -right-10 h-56 w-56 rounded-full bg-[#87fcc4]/10 blur-3xl" />

        <p className="text-xs font-bold uppercase tracking-wider text-primary">{t('Live workspace summary')}</p>
        <h2 className="mt-2 max-w-2xl text-xl font-extrabold leading-relaxed sm:text-2xl">
          {t('{n} projects connected, {m} deployed on Liara, {k} open incidents', {
            n: formatNumber(projects.length, locale),
            m: formatNumber(deployed, locale),
            k: formatNumber(openIncidents, locale),
          })}
        </h2>
        <p className="mt-1.5 text-[13px] leading-7 text-muted-foreground">
          {pendingApprovals > 0
            ? t('The agent is waiting for your decision on {n} operation(s).', { n: formatNumber(pendingApprovals, locale) })
            : t('No pending decisions — the agent only acts after your explicit approval.')}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => onOpenView('repos')} className="liara-gradient liara-glow font-semibold text-[#0b1512] hover:opacity-90">
            <Rocket className="me-1.5 h-3.5 w-3.5 text-[#0b1512]" />
            {t('Select from my repositories')}
          </Button>
          <Button size="sm" variant="ghost" className="border border-border" onClick={() => onOpenView('settings')}>
            <Plug className="me-1.5 h-3.5 w-3.5 text-primary" />
            {t('Open settings & connect')}
          </Button>
          <Button size="sm" variant="ghost" className="border border-border" onClick={() => onOpenView('dashboard')}>
            <BarChart3 className="me-1.5 h-3.5 w-3.5 text-primary" />
            {t('Full dashboard')}
          </Button>
          <Button size="sm" variant="ghost" className="border border-border" onClick={() => onOpenView('guide')}>
            <BookOpen className="me-1.5 h-3.5 w-3.5 text-primary" />
            {t('Deploy guide')}
          </Button>
        </div>

        {/* KPI chips */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { icon: GitBranch, label: t('Projects'), value: projects.length, cls: 'text-primary' },
            { icon: Rocket, label: t('deployed'), value: deployed, cls: 'text-sky-300' },
            { icon: ShieldCheck, label: t('pending approvals'), value: pendingApprovals, cls: pendingApprovals > 0 ? 'text-amber-300' : 'text-primary' },
            { icon: Siren, label: t('open incidents'), value: openIncidents, cls: openIncidents > 0 ? 'text-red-300' : 'text-primary' },
          ].map((k) => (
            <div key={k.label} className="flex items-center gap-2.5 rounded-xl border border-border bg-card/60 px-3 py-2.5 backdrop-blur">
              <k.icon className={cn('h-4 w-4 shrink-0', k.cls)} />
              <div className="min-w-0">
                <p className="text-[10px] leading-tight text-muted-foreground">{k.label}</p>
                <p className="text-base font-bold leading-tight text-foreground">{formatNumber(k.value, locale)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {pendingApprovals > 0 && (
        <Alert className="border-amber-400/30 bg-amber-400/10">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-200">{t('{n} action(s) awaiting your approval', { n: pendingApprovals })}</AlertTitle>
          <AlertDescription className="text-amber-300">
            {t('The agent paused before performing consequential operations. Open the Approvals view to review evidence and decide.')}{' '}
            <button onClick={() => onOpenView('approvals')} className="font-bold underline underline-offset-4">{t('Approvals')}</button>
          </AlertDescription>
        </Alert>
      )}

      {attention.length > 0 && (
        <Card className="border-red-400/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-red-300">{t('Needs attention')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.map(({ project, incident }) => (
              <button
                key={incident.id}
                onClick={() => onOpenProject(project.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2 text-start hover:bg-red-500/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-red-300">{incident.title}</p>
                  <p className="text-xs text-red-300">{project.name} · {incident.kind} · {timeAgo(incident.lastSeenAt)}</p>
                </div>
                <StatusBadge status={incident.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Latest events feed ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4 text-primary" />
            {t('Latest events')}
          </CardTitle>
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-primary" onClick={() => onOpenView('activity')}>
            {t('View all activity')}
          </Button>
        </CardHeader>
        <CardContent>
          {latestEvents.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('No events yet — connect a repository to see the agent in action.')}</p>
          ) : (
            <ul className="space-y-1">
              {latestEvents.map((e) => {
                const meta = EVENT_META[e.kind] ?? { icon: Bot, key: e.kind.replace(/[._]/g, ' '), cls: 'text-muted-foreground' };
                const who = e.actor === 'user' ? t('you') : e.actor === 'system' ? t('system') : t('agent');
                return (
                  <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/40">
                    <span className="flex min-w-0 items-center gap-2.5 text-xs">
                      <meta.icon className={cn('h-3.5 w-3.5 shrink-0', meta.cls)} />
                      <span className="truncate text-foreground/90">{t(meta.key)}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">· {who}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/70">{timeAgo(e.at, locale)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Projects ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('Projects')}</h2>
          <p className="text-sm text-muted-foreground">{t('Connected repositories the agent watches and operates on.')}</p>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10">
            <div className="mx-auto max-w-xl text-center">
              <h3 className="text-base font-bold text-foreground">{t('Welcome to LiaraPilot')}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {t('Your autonomous DevOps & SRE copilot for Liara. Connect your services once, then chat, deploy and let the agent watch your apps 24/7.')}
              </p>
              <div className="mt-6 space-y-2.5 text-start">
                {[
                  { icon: Github, title: t('1 — Connect GitHub or GitLab'), desc: t('Browser login or a personal token — the agent reads YOUR repos (never writes code without approval).'), view: 'settings' as const },
                  { icon: Plug, title: t('2 — Connect Liara'), desc: t('Paste an API token from the Liara Console — deploys run for real on your own apps, always behind a human approval gate.'), view: 'settings' as const },
                  { icon: Bot, title: t('3 — Connect your AI (optional)'), desc: t('Your OpenAI-compatible key powers chat, diagnosis and reports. Without it, the agent still watches and reports deterministically.'), view: 'settings' as const },
                ].map((step, i) => (
                  <button
                    key={i}
                    onClick={() => onOpenView(step.view)}
                    className="flex w-full items-start gap-3 rounded-xl border border-border bg-card/70 p-3.5 text-start transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <step.icon className="h-4 w-4 text-primary" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{step.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{step.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground/70">{t('First connection takes ~30 seconds')}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id} className="cursor-pointer transition-colors hover:border-primary/40" onClick={() => onOpenProject(p.id)}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                    {p.repoProvider === 'gitlab' ? <GitLabMark className="h-3.5 w-3.5 shrink-0 text-amber-400" /> : <Github className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{p.name}</span>
                  </CardTitle>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground/80" dir="ltr">{p.repo}</p>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <HealthDot status={p.lastHealth?.status} />
                    {p.lastHealth ? `${p.lastHealth.status}${p.lastHealth.httpStatus ? ` · ${p.lastHealth.httpStatus}` : ''} · ${p.lastHealth.latencyMs ?? '—'}ms` : t('no checks yet')}
                  </span>
                  <span className="text-muted-foreground/80">{timeAgo(p.lastHealth?.at)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('Liara app')}</span>
                  <span className="font-mono text-[11px]" dir="ltr">{p.liaraAppName ?? t('not created')}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('Deployed rev')}</span>
                  <span className="font-mono text-[11px]" dir="ltr">{p.deployedSha ? p.deployedSha.slice(0, 7) : '—'}</span>
                </div>
                {p.lastRun && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <RunProgressInline runId={['succeeded', 'failed'].includes(p.lastRun.status) ? null : p.lastRun.id} onDone={onChanged} />
                    <StatusBadge status={p.lastRun.status} />
                  </div>
                )}
                {p.lastRun && ['succeeded', 'failed'].includes(p.lastRun.status) && (
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <StageLabel stage={p.lastRun.stage} />
                    <StatusBadge status={p.lastRun.status} />
                  </div>
                )}
                {p.openIncidents.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-red-300">
                    <AlertTriangle className="h-3.5 w-3.5" /> {t('{n} open incident(s)', { n: p.openIncidents.length })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Connect form ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Plus className="h-4 w-4" /> {t('Connect a repository')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" className="mb-3 border-primary/40 text-primary hover:bg-primary/10" onClick={() => onOpenView('repos')}>
            <Rocket className="me-1.5 h-3.5 w-3.5" />
            {t('Select from my repositories')}
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex overflow-hidden rounded-md border border-border sm:w-40" role="radiogroup" aria-label={t('Git provider')}>
              {(['github', 'gitlab'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={provider === p}
                  onClick={() => setProvider(p)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors',
                    provider === p ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {p === 'github' ? <Github className="h-3.5 w-3.5" /> : <GitLabMark className="h-3.5 w-3.5" />}
                  {p === 'github' ? 'GitHub' : 'GitLab'}
                </button>
              ))}
            </div>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={provider === 'github' ? t('owner') : t('group / owner')} className="sm:w-44" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('repository-name')} className="sm:w-60" dir="ltr" />
            <Button onClick={connect} disabled={connecting || !name.trim()} className="bg-primary hover:bg-primary/90">
              {connecting ? <RefreshCw className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <GitBranch className="me-1.5 h-3.5 w-3.5" />}
              {t('Connect & analyze')}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('Connection triggers automatic analysis only — never an automatic deployment. Public repositories work without a token; connect GitHub/GitLab in Settings for private repos.')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
