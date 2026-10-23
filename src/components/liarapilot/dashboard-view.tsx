'use client';

// Dashboard view: the complete at-a-glance picture — KPIs, run trends,
// status mix, incidents, recent runs and connected-services health.
// Pure CSS charts (no chart lib) so the dark Liara brand stays pixel-exact.
//
// Drag & drop: every widget card can be rearranged — grab the corner handle
// (HTML5 DnD on pointer devices) or use the ↑/↓ buttons (touch + keyboard).
// The order persists per browser workspace in localStorage, like the locale.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, type WorkspaceStats } from '@/lib/client';
import { formatNumber, timeAgo, useI18n } from '@/lib/i18n';
import { StatusBadge } from './status-bits';
import {
  Activity, CheckCircle2, ChevronDown, ChevronUp, Github, GitBranch, GripVertical,
  HeartPulse, KeyRound, RotateCcw, Rocket, ServerCog, ShieldCheck, Siren, Sparkles, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const RUN_KINDS: Record<string, string> = {
  deploy_pipeline: 'Deploy pipeline',
  incident_investigation: 'Incident investigation',
  chat_assist: 'Chat assist',
};

const INCIDENT_KINDS: Record<string, string> = {
  http_5xx: 'http 5xx',
  timeout: 'timeout',
  deployment_failed: 'deployment failed',
  unhealthy: 'unhealthy',
  resource_threshold: 'resource threshold',
};

// ── widget order (drag & drop) ──────────────────────────────────────────────
const DEFAULT_ORDER = ['kpi', 'runs', 'mix', 'health', 'incidents', 'recent', 'services'] as const;
type WidgetId = (typeof DEFAULT_ORDER)[number];
const ORDER_KEY = 'lp_dash_widgets';

function loadOrder(): WidgetId[] {
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return [...DEFAULT_ORDER];
    const parsed: unknown = JSON.parse(raw);
    const valid = Array.isArray(parsed)
      ? (parsed as unknown[]).filter((x): x is WidgetId => (DEFAULT_ORDER as readonly string[]).includes(x as string))
      : [];
    // dedupe, then append anything missing so the dashboard never loses a card
    const merged = [...new Set([...valid, ...DEFAULT_ORDER])] as WidgetId[];
    return merged.filter((id) => (DEFAULT_ORDER as readonly string[]).includes(id));
  } catch {
    return [...DEFAULT_ORDER];
  }
}

function saveOrder(order: WidgetId[]): void {
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    /* private mode */
  }
}

// ── drag & drop widget wrapper ──────────────────────────────────────────────
function DndWidget({
  id, index, order, onOrder, dragId, setDragId, className, children,
}: {
  id: WidgetId;
  index: number;
  order: WidgetId[];
  onOrder: (next: WidgetId[]) => void;
  dragId: WidgetId | null;
  setDragId: (id: WidgetId | null) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);

  const move = (delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onOrder(next);
  };

  const dropOn = (src: WidgetId | null) => {
    if (!src || src === id) return;
    const from = order.indexOf(src);
    const to = order.indexOf(id);
    if (from === -1 || to === -1) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onOrder(next);
  };

  return (
    <div
      className={cn(
        'group/widget relative select-none rounded-xl transition-opacity',
        dragId && dragId !== id && over && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        dragId === id && 'opacity-40',
        className,
      )}
      // Native drag from anywhere on the card — simple clicks still pass
      // through to buttons because dragstart needs real pointer movement.
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        setDragId(id);
      }}
      onDragEnd={() => {
        setDragId(null);
        setOver(false);
      }}
      onDragOver={(e) => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        const src = (e.dataTransfer.getData('text/plain') || dragId) as WidgetId | null;
        dropOn(src);
        setOver(false);
      }}
    >
      {/* handle cluster — hidden until hover/focus, always available to touch */}
      <div
        className="absolute end-2 top-2 z-10 flex flex-col gap-0.5 opacity-0 transition-opacity group-focus-within/widget:opacity-100 group-hover/widget:opacity-100"
        dir="ltr"
      >
        <span
          className="flex h-6 w-6 cursor-grab touch-none items-center justify-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground active:cursor-grabbing"
          aria-hidden
          title={t('Drag to rearrange')}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => move(-1)}
            className="flex h-5 w-6 items-center justify-center rounded-t-md border border-border bg-card/95 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground disabled:opacity-30"
            disabled={index === 0}
            aria-label={t('Move up')}
            title={t('Move up')}
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            className="flex h-5 w-6 items-center justify-center rounded-b-md border border-t-0 border-border bg-card/95 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground disabled:opacity-30"
            disabled={index === order.length - 1}
            aria-label={t('Move down')}
            title={t('Move down')}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── widgets ─────────────────────────────────────────────────────────────────
function Kpi({
  icon: Icon, label, value, sub, tone,
}: {
  icon: typeof Rocket; label: string; value: string; sub?: string; tone: 'mint' | 'sky' | 'amber' | 'coral';
}) {
  const tones = {
    mint: 'bg-primary/10 text-primary border-primary/25',
    sky: 'bg-sky-400/10 text-sky-300 border-sky-400/25',
    amber: 'bg-amber-400/10 text-amber-300 border-amber-400/25',
    coral: 'bg-red-400/10 text-red-300 border-red-400/25',
  } as const;
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="flex items-center gap-3.5 p-4">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border', tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="liara-gradient-text text-2xl font-bold leading-tight">{value}</p>
          {sub && <p className="truncate text-[11px] text-muted-foreground/80">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function RunsChart({ stats }: { stats: WorkspaceStats }) {
  const { t, locale } = useI18n();
  const days = stats.runs14d.byDay;
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-primary" />
          {t('Agent runs — last 14 days')}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t('Deploy pipelines, investigations and chat assists per day')}</p>
      </CardHeader>
      <CardContent>
        <div className="flex h-40 items-end justify-between gap-1.5" dir="ltr">
          {days.map((d) => {
            const h = (n: number) => `${Math.round((n / max) * 100)}%`;
            const dateNum = Number(d.day.slice(8, 10));
            return (
              <div key={d.day} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <div className="relative flex h-32 w-full flex-col justify-end overflow-hidden rounded-md">
                  {/* failed on top, succeeded below */}
                  <div className="w-full rounded-t-md bg-red-400/70 transition-colors group-hover:bg-red-400" style={{ height: h(d.failed) }} />
                  <div className="w-full bg-primary/70 transition-colors group-hover:bg-primary" style={{ height: h(d.succeeded) }} />
                  <div className="w-full bg-amber-400/70" style={{ height: h(d.active) }} />
                  {d.total === 0 && <div className="absolute inset-x-0 bottom-0 h-px bg-border" />}
                  <span
                    className="pointer-events-none absolute inset-x-0 -top-1 text-center text-[10px] font-semibold text-foreground/80 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    {formatNumber(d.total, locale)}
                  </span>
                </div>
                <span className="text-[9px] tabular-nums text-muted-foreground/70">{formatNumber(dateNum, locale)}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-primary/70" />{t('succeeded runs')}</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-red-400/70" />{t('failed runs')}</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-amber-400/70" />{t('active runs')}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusMix({ stats }: { stats: WorkspaceStats }) {
  const { t, locale } = useI18n();
  const { total, succeeded, failed, active } = stats.runs14d;
  const other = Math.max(0, total - succeeded - failed - active);
  const seg = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%');
  const rows = [
    { label: t('succeeded runs'), n: succeeded, cls: 'bg-primary' },
    { label: t('failed runs'), n: failed, cls: 'bg-red-400' },
    { label: t('active runs'), n: active, cls: 'bg-amber-400' },
    { label: t('other statuses'), n: other, cls: 'bg-muted-foreground/40' },
  ].filter((r) => r.n > 0);
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t('Status mix (14 days)')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" dir="ltr">
          {rows.map((r) => (
            <div key={r.label} className={cn('h-full', r.cls)} style={{ width: seg(r.n) }} />
          ))}
        </div>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <i className={cn('h-2.5 w-2.5 rounded-full', r.cls)} />
                {r.label}
              </span>
              <span className="font-semibold text-foreground">
                {formatNumber(r.n, locale)}
                {total > 0 && <span className="ms-1 text-[10px] font-normal text-muted-foreground">{Math.round((r.n / total) * 100)}%</span>}
              </span>
            </li>
          ))}
        </ul>
        {stats.runs14d.successRate !== null && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-center">
            <p className="text-[11px] text-muted-foreground">{t('deploy success rate')}</p>
            <p className="liara-gradient-text text-xl font-bold">{formatNumber(stats.runs14d.successRate, locale)}٪</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardView({ onOpenView }: { onOpenView?: (v: 'incidents' | 'approvals' | 'activity' | 'settings') => void }) {
  const { t, locale } = useI18n();
  const [order, setOrderRaw] = useState<WidgetId[]>(() => [...DEFAULT_ORDER]);
  const [dragId, setDragId] = useState<WidgetId | null>(null);

  // localStorage is unavailable during SSR — hydrate after mount (async so the
  // effect body does not setState synchronously).
  useEffect(() => {
    const id = setTimeout(() => setOrderRaw(loadOrder()), 0);
    return () => clearTimeout(id);
  }, []);

  const setOrder = (next: WidgetId[]) => {
    setOrderRaw(next);
    saveOrder(next);
  };
  const resetOrder = () => {
    setOrderRaw([...DEFAULT_ORDER]);
    try {
      window.localStorage.removeItem(ORDER_KEY);
    } catch {
      /* private mode */
    }
  };

  const statsQ = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 15000 });
  const llmQ = useQuery({ queryKey: ['llm-status'], queryFn: api.llmStatus, refetchInterval: 30000 });
  const connQ = useQuery({ queryKey: ['connections'], queryFn: api.connections, refetchInterval: 30000 });

  const stats = statsQ.data;
  const llm = llmQ.data;
  const conn = connQ.data;

  if (statsQ.isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{t('Loading dashboard…')}</p>;
  }
  if (statsQ.error || !stats) {
    return <p className="py-16 text-center text-sm text-red-400">{(statsQ.error as Error)?.message ?? t('stats unavailable')}</p>;
  }

  const services = [
    {
      id: 'llm',
      icon: Sparkles,
      name: t('Decision engine (LLM)'),
      ok: llm?.provider === 'chatgpt' || llm?.provider === 'zai',
      badge: llm?.provider === 'chatgpt' ? t('chatgpt') : llm?.provider === 'zai' ? t('z-ai') : t('ai off'),
      badgeCls: llm?.provider === 'chatgpt' ? 'border-primary/40 text-primary' : llm?.provider === 'zai' ? 'border-sky-400/30 text-sky-300' : 'border-amber-400/30 text-amber-300',
      note: llm?.provider === 'chatgpt' ? t('model {model}', { model: llm?.model ?? '' }) : llm?.provider === 'zai' ? t('Built-in model — connect your own key in Settings') : t('Connect your AI in Settings'),
      action: 'settings' as const,
    },
    {
      id: 'github',
      icon: Github,
      name: 'GitHub',
      ok: Boolean(conn?.github?.verified),
      badge: conn?.github?.verified ? t('connected') : t('not connected'),
      badgeCls: conn?.github?.verified ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground',
      note: conn?.github?.login ? `@${conn.github.login} · ${conn.github.via}` : t('Browser login or a token in Settings'),
      action: 'settings' as const,
    },
    {
      id: 'gitlab',
      icon: GitBranch,
      name: 'GitLab',
      ok: Boolean(conn?.gitlab?.verified),
      badge: conn?.gitlab?.verified ? t('connected') : t('not connected'),
      badgeCls: conn?.gitlab?.verified ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground',
      note: conn?.gitlab?.login ? `@${conn.gitlab.login} · ${conn.gitlab.via}` : t('Browser login or a token in Settings'),
      action: 'settings' as const,
    },
    {
      id: 'liara',
      icon: ServerCog,
      name: t('Liara platform'),
      ok: Boolean(conn?.liara?.verified),
      badge: conn?.liara?.verified ? t('real operations') : t('not connected'),
      badgeCls: conn?.liara?.verified ? 'border-primary/40 text-primary' : 'border-amber-400/30 text-amber-300',
      note: conn?.liara?.accountEmail ? t('Liara connected as {account}', { account: conn.liara.accountEmail }) : t('Connect your Liara API token in Settings'),
      action: 'settings' as const,
    },
  ];

  const widgets: Record<WidgetId, React.ReactNode> = {
    kpi: (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi icon={GitBranch} tone="mint" label={t('Connected projects')} value={formatNumber(stats.projects.total, locale)} sub={t('{n} deployed on Liara', { n: formatNumber(stats.projects.deployed, locale) })} />
        <Kpi icon={Rocket} tone="sky" label={t('Runs (14 days)')} value={formatNumber(stats.runs14d.total, locale)} sub={t('{n} active right now', { n: formatNumber(stats.runs14d.active, locale) })} />
        <Kpi icon={Siren} tone={stats.incidents.open > 0 ? 'coral' : 'mint'} label={t('Open incidents')} value={formatNumber(stats.incidents.open, locale)} sub={t('{n} resolved so far', { n: formatNumber(stats.incidents.resolved, locale) })} />
        <Kpi icon={CheckCircle2} tone={stats.approvals.pending > 0 ? 'amber' : 'mint'} label={t('Awaiting approval')} value={formatNumber(stats.approvals.pending, locale)} sub={t('{n} approved · {n2} rejected', { n: formatNumber(stats.approvals.approved, locale), n2: formatNumber(stats.approvals.rejected, locale) })} />
      </div>
    ),
    runs: <RunsChart stats={stats} />,
    mix: <StatusMix stats={stats} />,
    health: (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <HeartPulse className="h-4 w-4 text-primary" />
            {t('Health checks (24h)')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[11px] text-muted-foreground">{t('total checks')}</p>
            <p className="text-lg font-bold text-foreground">{formatNumber(stats.health24h.checks, locale)}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[11px] text-muted-foreground">{t('uptime rate')}</p>
            <p className="text-lg font-bold text-foreground">{stats.health24h.upRate !== null ? `${formatNumber(stats.health24h.upRate, locale)}٪` : '—'}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[11px] text-muted-foreground">{t('avg latency')}</p>
            <p className="text-lg font-bold text-foreground">{stats.health24h.avgLatencyMs !== null ? formatNumber(stats.health24h.avgLatencyMs, locale) : '—'}<span className="text-[10px] font-normal text-muted-foreground"> ms</span></p>
          </div>
          {stats.incidents.open > 0 && (
            <button onClick={() => onOpenView?.('incidents')} className="col-span-3 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/15">
              {t('{n} open incident(s)', { n: formatNumber(stats.incidents.open, locale) })} — {t('open incidents view')}
            </button>
          )}
        </CardContent>
      </Card>
    ),
    incidents: (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Siren className="h-4 w-4 text-primary" />
            {t('Incidents by kind')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(stats.incidents.byKind).length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('No incidents recorded — all clear.')}</p>
          ) : (
            <ul className="space-y-2.5">
              {Object.entries(stats.incidents.byKind).sort((a, b) => b[1] - a[1]).map(([kind, n]) => (
                <li key={kind} className="flex items-center gap-3 text-xs">
                  <span className="w-32 shrink-0 text-muted-foreground">{t(INCIDENT_KINDS[kind] ?? kind)}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', ['http_5xx', 'deployment_failed', 'unhealthy', 'timeout'].includes(kind) ? 'bg-red-400/80' : 'bg-amber-400/80')} style={{ width: `${Math.min(100, (n / Math.max(...Object.values(stats.incidents.byKind))) * 100)}%` }} />
                  </div>
                  <span className="w-8 text-end font-semibold text-foreground">{formatNumber(n, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    ),
    recent: (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            {t('Recent runs')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {stats.recentRuns.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">{t('No runs yet — connect a project and request a deployment.')}</p>}
          {stats.recentRuns.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">
                  {r.projectName ?? t('workspace')}
                  <span className="ms-2 font-normal text-muted-foreground">{t(RUN_KINDS[r.kind] ?? r.kind)}</span>
                </p>
                <p className="text-[10px] text-muted-foreground/70">{timeAgo(r.createdAt, locale)}</p>
              </div>
              <StatusBadge status={r.status} className="shrink-0 text-[10px]" />
            </div>
          ))}
        </CardContent>
      </Card>
    ),
    services: (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-primary" />
            {t('Connected services')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => onOpenView?.('settings')}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-start transition-colors hover:bg-muted/40"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <s.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{s.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground/80">{s.note}</p>
                </div>
              </div>
              <Badge variant="outline" className={cn('shrink-0 text-[10px]', s.badgeCls)}>{s.badge}</Badge>
            </button>
          ))}
          <p className="flex items-center gap-1.5 pt-1 text-[10px] text-muted-foreground/70">
            <XCircle className="h-3 w-3" />
            {t('Tokens are stored as encrypted references and always masked in UI/logs.')}
          </p>
        </CardContent>
      </Card>
    ),
  };

  return (
    <div className="space-y-5">
      {/* layout toolbar — drag & drop affordance */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-foreground">{t('Dashboard')}</h2>
          <p className="hidden text-[11px] text-muted-foreground/80 sm:block">
            {t('Drag the handle on any card to rearrange — the order is saved for this browser.')}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 border border-border text-[11px] text-muted-foreground hover:text-foreground" onClick={resetOrder}>
          <RotateCcw className="h-3 w-3" />
          {t('Reset layout')}
        </Button>
      </div>

      {/* reorderable widget grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {order.map((id, index) => (
          <DndWidget
            key={id}
            id={id}
            index={index}
            order={order}
            onOrder={setOrder}
            dragId={dragId}
            setDragId={setDragId}
            className={id === 'kpi' ? 'lg:col-span-2' : undefined}
          >
            {widgets[id]}
          </DndWidget>
        ))}
      </div>
    </div>
  );
}
