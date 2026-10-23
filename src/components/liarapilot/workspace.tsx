'use client';

// LiaraPilot workspace shell (spec §11): task-oriented, effort-minimizing.
// Single-page operational workspace — no decorative filler, every control real.
// No site login: the workspace is open; services connect from Settings.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type IncidentDetail, type IncidentSummary, type ProjectDetail as ProjectDetailDTO } from '@/lib/client';
import { formatNumber, useI18n } from '@/lib/i18n';
import { Overview } from './overview';
import { ReposView } from './repos-view';
import { ProjectDetail } from './project-detail';
import { ApprovalsView } from './approvals-view';
import { IncidentsListView, IncidentDetailView } from './incidents-view';
import { ActivityView } from './activity-view';
import { ChatPanel } from './chat-panel';
import { SettingsView } from './settings-view';
import { DashboardView } from './dashboard-view';
import { GuideView } from './guide-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, BarChart3, Bot, BookOpen, CheckSquare, FolderGit2, GitBranch, Languages, LayoutDashboard, MessageSquare, Send, Settings, ShieldAlert, Siren } from 'lucide-react';
import { cn } from '@/lib/utils';

type View = 'overview' | 'repos' | 'dashboard' | 'project' | 'incidents' | 'incident' | 'approvals' | 'activity' | 'chat' | 'guide' | 'settings';

const NAV: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'repos', label: 'Repositories', icon: FolderGit2 },
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'incidents', label: 'Incidents', icon: Siren },
  { id: 'approvals', label: 'Approvals', icon: CheckSquare },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'guide', label: 'Deploy guide', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Workspace() {
  const qc = useQueryClient();
  const { t, locale, setLocale } = useI18n();
  const [view, setView] = useState<View>('overview');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [notice] = useState<string | null>(null);

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects,
    refetchInterval: 8000,
  });

  const approvalsQ = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: () => api.approvals('pending'),
    refetchInterval: 10000,
  });

  const incidentsQ = useQuery({
    queryKey: ['incidents'],
    queryFn: () => api.incidents('all'),
    refetchInterval: 10000,
  });

  const llmQ = useQuery({
    queryKey: ['llm-status'],
    queryFn: api.llmStatus,
    refetchInterval: 30_000,
  });

  const projectDetailQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.projectDetail(projectId!),
    enabled: Boolean(projectId) && view === 'project',
  });

  const incidentDetailQ = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => api.incidentDetail(incidentId!),
    enabled: Boolean(incidentId) && view === 'incident',
  });

  const auditQ = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.audit(80),
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!notice) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('oauth')) {
      url.searchParams.delete('oauth');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [notice]);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'fa' ? 'en' : 'fa');
  }, [locale, setLocale]);

  const refreshAll = useCallback(() => {
    void projectsQ.refetch();
    void approvalsQ.refetch();
    void incidentsQ.refetch();
    void auditQ.refetch();
  }, [projectsQ, approvalsQ, incidentsQ, auditQ]);

  const openProject = (id: string) => {
    setProjectId(id);
    setView('project');
  };
  const openIncident = (id: string) => {
    setIncidentId(id);
    setView('incident');
  };

  const pendingApprovals = projectsQ.data?.pendingApprovals ?? 0;
  const openIncidents = useMemo(
    () => (incidentsQ.data?.incidents ?? []).filter((i) => !['resolved', 'muted'].includes(i.status)),
    [incidentsQ.data],
  );

  const projects = projectsQ.data?.projects ?? [];
  const detail = projectDetailQ.data as ProjectDetailDTO | undefined;
  const incDetail = incidentDetailQ.data as IncidentDetail | undefined;
  const approvals = approvalsQ.data?.approvals ?? [];
  const incidents = incidentsQ.data?.incidents ?? [];
  const auditEvents = auditQ.data?.events ?? [];
  const llm = llmQ.data;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Ambient brand glows (liara.ir design language) */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 left-1/4 h-[28rem] w-[28rem] rounded-full bg-[#87fcc4]/[0.07] blur-[130px]" />
        <div className="absolute right-[-8rem] top-1/3 h-[26rem] w-[26rem] rounded-full bg-[#28c1f5]/[0.07] blur-[130px]" />
        <div className="absolute bottom-[-10rem] left-[-6rem] h-[24rem] w-[24rem] rounded-full bg-[#87fcc4]/[0.05] blur-[120px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-card/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="liara-gradient liara-glow flex h-9 w-9 items-center justify-center rounded-xl text-[#0b1512] shadow-lg">
              <Send className="h-4 w-4 -translate-x-px translate-y-px rtl:scale-x-[-1]" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="liara-gradient-text text-sm font-bold leading-tight">LiaraPilot</h1>
              <p className="hidden text-[10px] leading-tight text-muted-foreground sm:block">{t('autonomous DevOps & SRE agent')}</p>
            </div>
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-[10px] uppercase text-primary">
              <span className="hidden sm:inline">{t('real operations')}</span>
              <span className="sm:hidden">{t('real')}</span>
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {llm && (
              <Badge
                variant="outline"
                className={cn(
                  'hidden text-[10px] uppercase sm:inline-flex',
                  llm.provider === 'chatgpt' ? 'border-primary/40 text-primary' : llm.provider === 'zai' ? 'border-sky-400/30 text-sky-300' : 'border-amber-400/30 text-amber-300',
                )}
                title={
                  llm.provider === 'chatgpt'
                    ? t('ChatGPT ({model}) is answering', { model: llm.model ?? '' })
                    : llm.provider === 'zai'
                      ? t('Built-in z-ai model answering — connect your own AI key in Settings')
                      : t('No AI connected — connect your own AI key in Settings')
                }
              >
                <Bot className="me-1 h-3 w-3" />
                {llm.provider === 'chatgpt' ? t('chatgpt') : llm.provider === 'zai' ? t('z-ai') : t('ai off')}
              </Badge>
            )}
            {openIncidents.length > 0 && (
              <Button variant="outline" size="sm" className="border-red-400/30 text-red-300 hover:bg-red-500/10" onClick={() => setView('incidents')} aria-label={t('{n} open', { n: openIncidents.length })}>
                <Siren className="me-1.5 h-3.5 w-3.5" /><span className="hidden sm:inline">{t('{n} open', { n: openIncidents.length })}</span><span className="sm:hidden">{t('{n} open', { n: openIncidents.length })}</span>
              </Button>
            )}
            {pendingApprovals > 0 && (
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600" onClick={() => setView('approvals')} aria-label={t('{n} awaiting approval', { n: pendingApprovals })}>
                <ShieldAlert className="me-1.5 h-3.5 w-3.5" /><span className="hidden sm:inline">{t('{n} awaiting approval', { n: pendingApprovals })}</span><span className="sm:hidden">{t('{n} awaiting approval', { n: pendingApprovals })}</span>
              </Button>
            )}
            <button
              onClick={toggleLocale}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('Switch language')}
              title={t('Switch language')}
            >
              <Languages className="h-3.5 w-3.5" />
              {locale === 'fa' ? 'فارسی' : 'English'}
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-3">
          <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">{t(notice)}</div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-6">
        {/* Sidebar */}
        <nav className="hidden w-48 shrink-0 md:block" aria-label="workspace navigation">
          <ul className="sticky top-20 space-y-1">
            {NAV.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setView(n.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    view === n.id || (n.id === 'incidents' && view === 'incident') || (n.id === 'overview' && view === 'project')
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  aria-current={view === n.id ? 'page' : undefined}
                >
                  <n.icon className="h-4 w-4" />
                  {t(n.label)}
                  {n.id === 'approvals' && pendingApprovals > 0 && (
                    <Badge className="ms-auto h-5 bg-amber-500 px-1.5 text-[10px] text-white">{formatNumber(pendingApprovals, locale)}</Badge>
                  )}
                  {n.id === 'incidents' && openIncidents.length > 0 && (
                    <Badge className="ms-auto h-5 bg-red-500 px-1.5 text-[10px] text-white">{formatNumber(openIncidents.length, locale)}</Badge>
                  )}
                </button>
              </li>
            ))}
            <li className="pt-3">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{t('Projects')}</p>
              <ul className="space-y-0.5">
                {projects.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => openProject(p.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-start text-xs transition-colors',
                        projectId === p.id && view === 'project' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <GitBranch className="h-3 w-3 shrink-0" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        </nav>

        {/* Mobile nav */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur-xl md:hidden">
          <div className="flex justify-around px-0.5 py-1.5">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={cn('flex min-w-0 flex-col items-center gap-0.5 px-1 py-1 text-[9px] leading-tight', view === n.id ? 'text-primary' : 'text-muted-foreground')}
                aria-label={t(n.label)}
              >
                <n.icon className="h-4 w-4" />
                <span className="truncate">{t(n.label)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main */}
        <main className="min-w-0 flex-1 pb-16 md:pb-0">
          <ScrollArea className="h-full">
            {view === 'overview' && (
              <Overview
                projects={projects}
                pendingApprovals={pendingApprovals}
                events={auditEvents}
                onChanged={refreshAll}
                onOpenProject={openProject}
                onOpenView={(v) => setView(v)}
              />
            )}
            {view === 'repos' && <ReposView projects={projects} onOpenProject={openProject} onOpenView={(v) => setView(v)} />}
            {view === 'dashboard' && <DashboardView onOpenView={(v) => setView(v)} />}
            {view === 'project' && (
              <>
                {projectDetailQ.isLoading && <p className="text-sm text-muted-foreground">{t('Loading project…')}</p>}
                {projectDetailQ.error && <p className="text-sm text-red-400">{(projectDetailQ.error as Error).message}</p>}
                {detail && <ProjectDetail detail={detail} onChanged={refreshAll} onOpenIncident={openIncident} onOpenApprovals={() => setView('approvals')} />}
              </>
            )}
            {view === 'incidents' && <IncidentsListView incidents={incidents} onOpen={openIncident} />}
            {view === 'incident' && (
              <>
                {incidentDetailQ.isLoading && <p className="text-sm text-muted-foreground">{t('Loading incident…')}</p>}
                {incidentDetailQ.error && <p className="text-sm text-red-400">{(incidentDetailQ.error as Error).message}</p>}
                {incDetail && <IncidentDetailView detail={incDetail} onChanged={refreshAll} onOpenApprovals={() => setView('approvals')} />}
              </>
            )}
            {view === 'approvals' && <ApprovalsView approvals={approvals} onChanged={refreshAll} />}
            {view === 'activity' && <ActivityView events={auditEvents} />}
            {view === 'chat' && <ChatPanel projects={projects} currentProjectId={projectId} />}
            {view === 'guide' && <GuideView />}
            {view === 'settings' && <SettingsView />}
          </ScrollArea>
        </main>
      </div>

      {/* Sticky footer (skill requirement) */}
      <footer className="mt-auto border-t border-border bg-card/50">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 text-[11px] text-muted-foreground/80 sm:flex-row sm:items-center sm:justify-between">
          <span>{t('LiaraPilot — evidence over assumptions. Consequential operations require approval; every action is audited.')}</span>
          <span>{t('Private per-browser workspace · tokens encrypted (AES-256-GCM) · no env credentials')}</span>
        </div>
      </footer>
    </div>
  );
}
