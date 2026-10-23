'use client';

// Repositories browser: the user's OWN repos from the connected GitHub/GitLab
// account (their encrypted token — never env). Pick one → connect → the deploy
// pipeline starts and pauses at the approval gate → approve → REAL deploy →
// the final https://<app>.liara.run link appears on the project page.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type ProjectSummary } from '@/lib/client';
import { formatNumber, useI18n } from '@/lib/i18n';
import { timeAgo } from './status-bits';
import {
  AlertTriangle, ExternalLink, FolderGit2, GitBranch, Github, Lock, Plug,
  RefreshCw, Rocket, Search, Star, Unlock,
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

export function ReposView({
  projects,
  onOpenProject,
  onOpenView,
}: {
  projects: ProjectSummary[];
  onOpenProject: (id: string) => void;
  onOpenView: (v: 'settings' | 'approvals') => void;
}) {
  const { t, locale } = useI18n();
  const [provider, setProvider] = useState<'github' | 'gitlab'>('github');
  const [query, setQuery] = useState('');
  const [busyRepo, setBusyRepo] = useState<string | null>(null);

  const connQ = useQuery({ queryKey: ['connections'], queryFn: api.connections, staleTime: 30_000 });
  const reposQ = useQuery({
    queryKey: ['repos', provider],
    queryFn: () => api.repos(provider),
    staleTime: 60_000,
  });

  const githubConnected = Boolean(connQ.data?.github);
  const gitlabConnected = Boolean(connQ.data?.gitlab);

  // if the active provider is not connected but the other one is, follow it
  const effectiveProvider = provider === 'github' && !githubConnected && gitlabConnected ? 'gitlab' : provider === 'gitlab' && !gitlabConnected && githubConnected ? 'github' : provider;

  const repos = reposQ.data?.repos ?? [];
  const connectedRepos = useMemo(() => {
    const map = new Map<string, ProjectSummary>();
    for (const p of projects) map.set(`${p.repoProvider}:${p.repo}`, p);
    return map;
  }, [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) =>
      `${r.fullName} ${r.description ?? ''} ${r.language ?? ''}`.toLowerCase().includes(q),
    );
  }, [repos, query]);

  const connectAndDeploy = async (repo: { owner: string; name: string; defaultBranch: string; fullName: string }) => {
    setBusyRepo(repo.fullName);
    try {
      const res = await api.connectProject({ owner: repo.owner, name: repo.name, branch: repo.defaultBranch || undefined, provider: effectiveProvider });
      let pipelineNote = '';
      try {
        await api.requestDeploy(res.project.id);
        pipelineNote = t('Repository connected — deploy pipeline started, pausing at the approval gate');
      } catch (de) {
        // Liara not connected (or similar) — the project is still connected & analyzed
        pipelineNote = de instanceof Error ? `${t('Repository connected — analysis started automatically')} · ${de.message}` : t('Repository connected — analysis started automatically');
      }
      toast.success(pipelineNote, { duration: 6000 });
      onOpenProject(res.project.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('connect failed'));
    } finally {
      setBusyRepo(null);
    }
  };

  const connected = effectiveProvider === 'github' ? githubConnected : gitlabConnected;
  const anyConnected = githubConnected || gitlabConnected;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <FolderGit2 className="h-5 w-5 text-primary" />
            {t('Repositories')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('My repositories from GitHub & GitLab — pick one and deploy it to Liara.')}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="border border-border"
          onClick={() => void reposQ.refetch()}
          disabled={reposQ.isFetching}
        >
          <RefreshCw className={cn('me-1.5 h-3.5 w-3.5', reposQ.isFetching && 'animate-spin')} />
          {t('Refresh list')}
        </Button>
      </div>

      {/* Provider tabs + search */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex overflow-hidden rounded-md border border-border sm:w-52" role="radiogroup" aria-label={t('Git provider')}>
          {(['github', 'gitlab'] as const).map((p) => {
            const on = p === 'github' ? githubConnected : gitlabConnected;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={effectiveProvider === p}
                onClick={() => setProvider(p)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors',
                  effectiveProvider === p ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:bg-muted',
                  !on && 'opacity-70',
                )}
              >
                {p === 'github' ? <Github className="h-3.5 w-3.5" /> : <GitLabMark className="h-3.5 w-3.5" />}
                {p === 'github' ? 'GitHub' : 'GitLab'}
                {on ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" aria-hidden />}
              </button>
            );
          })}
        </div>
        <div className="relative flex-1">
          <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search repositories…')}
            className="ps-8"
            aria-label={t('Search repositories…')}
          />
        </div>
        {reposQ.data?.connected && (
          <Badge variant="outline" className="border-primary/30 text-[11px] text-primary">
            {formatNumber(repos.length, locale)} {t('repos')}
          </Badge>
        )}
      </div>

      {/* Body states */}
      {reposQ.isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
          ))}
        </div>
      ) : !anyConnected ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <Plug className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <h3 className="mt-3 text-base font-bold text-foreground">{t('Connect GitHub or GitLab first')}</h3>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
              {t('Your repositories appear here once you connect your GitHub/GitLab account — browser login or a personal token, both from Settings.')}
            </p>
            <Button size="sm" className="mt-4 liara-gradient liara-glow font-semibold text-[#0b1512]" onClick={() => onOpenView('settings')}>
              <Plug className="me-1.5 h-3.5 w-3.5 text-[#0b1512]" />
              {t('Open settings & connect')}
            </Button>
          </CardContent>
        </Card>
      ) : !reposQ.data?.connected ? (
        <Card className="border-amber-400/30 bg-amber-400/5">
          <CardContent className="flex items-start gap-3 py-5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-200">{reposQ.data?.hint ?? t('Connect GitHub or GitLab first')}</p>
              <Button size="sm" variant="outline" className="mt-3 border-amber-400/30 text-amber-200 hover:bg-amber-400/10" onClick={() => onOpenView('settings')}>
                {t('Open settings & connect')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <FolderGit2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              {repos.length === 0 ? t('No repositories found — the connected account has no accessible repositories.') : t('No repositories matched your search.')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((r) => {
            const key = `${r.provider}:${r.fullName}`;
            const project = connectedRepos.get(key);
            const busy = busyRepo === r.fullName;
            return (
              <li key={key}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {r.provider === 'gitlab' ? <GitLabMark className="h-3.5 w-3.5 shrink-0 text-amber-400" /> : <Github className="h-3.5 w-3.5 shrink-0" />}
                        <a href={r.url} target="_blank" rel="noreferrer" className="truncate font-mono text-sm font-medium text-foreground hover:text-primary" dir="ltr">
                          {r.fullName}
                          <ExternalLink className="ms-1 inline h-3 w-3 text-muted-foreground/60" />
                        </a>
                        {r.private ? (
                          <Badge variant="outline" className="border-amber-400/30 text-[10px] text-amber-300"><Lock className="me-1 h-2.5 w-2.5" />{t('private')}</Badge>
                        ) : (
                          <Badge variant="outline" className="border-border text-[10px] text-muted-foreground"><Unlock className="me-1 h-2.5 w-2.5" />{t('public')}</Badge>
                        )}
                        {r.fork && <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">{t('fork')}</Badge>}
                        {project && (
                          <Badge className="bg-primary/15 text-[10px] text-primary hover:bg-primary/15">{t('connected')}</Badge>
                        )}
                      </div>
                      {r.description && (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{r.description}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
                        {r.language && (
                          <span className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-gradient-to-br from-[#87fcc4] to-[#28c1f5]" aria-hidden />
                            {r.language}
                          </span>
                        )}
                        <span className="flex items-center gap-1" dir="ltr"><GitBranch className="h-3 w-3" />{r.defaultBranch}</span>
                        {r.stars > 0 && <span className="flex items-center gap-1" dir="ltr"><Star className="h-3 w-3" />{formatNumber(r.stars, locale)}</span>}
                        {r.pushedAt && <span>{t('updated')} {timeAgo(r.pushedAt, locale)}</span>}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {project ? (
                        <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10" onClick={() => onOpenProject(project.id)}>
                          <GitBranch className="me-1.5 h-3.5 w-3.5" /> {t('Open project')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="liara-gradient liara-glow font-semibold text-[#0b1512] hover:opacity-90"
                          onClick={() => void connectAndDeploy({ owner: r.owner, name: r.name, defaultBranch: r.defaultBranch, fullName: r.fullName })}
                          disabled={busy}
                        >
                          {busy ? <RefreshCw className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="me-1.5 h-3.5 w-3.5 text-[#0b1512]" />}
                          {busy ? t('Connecting…') : t('Connect & deploy')}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        {t('Deploys always pause at the approval gate — nothing runs on Liara until you approve. The first approved deploy also creates the app (cheapest plan) if it does not exist.')}
      </p>
    </div>
  );
}
