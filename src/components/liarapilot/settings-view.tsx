'use client';

// SettingsView — per-user service connections (commercial model: NO env vars,
// NO site login). Every token is entered by the user, validated live against
// the provider, then stored AES-256-GCM encrypted for THIS browser workspace.
// GitHub/GitLab support real browser login via the OAuth Device Flow.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast as sonnerToast } from 'sonner';
import { api, type DeviceStart } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Bot, Brain, CheckCircle2, Copy, ExternalLink, Github, KeyRound, Loader2,
  Lock, MonitorSmartphone, PlugZap, ShieldCheck, Unlink, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const toast = sonnerToast;

function GitLabMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

function StatusPill({ connected, via, labels }: { connected: boolean; via?: string; labels: { notConnected: string; connectedVia: string; pat: string; oauth: string } }) {
  if (!connected) return <Badge variant="outline" className="border-muted text-muted-foreground">{labels.notConnected}</Badge>;
  return (
    <Badge className="border-transparent bg-primary/15 text-primary">
      <CheckCircle2 className="me-1 h-3 w-3" />{' '}
      {labels.connectedVia.replace('{via}', via === 'oauth' ? labels.oauth : labels.pat)}
    </Badge>
  );
}

function CardShell(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card/60 p-5 backdrop-blur">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">{props.icon}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{props.title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{props.subtitle}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Device Flow modal — the actual "login with browser" experience
// ---------------------------------------------------------------------------

function DeviceFlowModal({ provider, onClose }: { provider: 'github' | 'gitlab'; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [start, setStart] = useState<DeviceStart | null>(null);
  const [phase, setPhase] = useState<'starting' | 'waiting' | 'done' | 'denied' | 'expired' | 'error'>('starting');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(
    (ok: boolean, login?: string) => {
      setPhase(ok ? 'done' : 'error');
      if (ok) {
        toast.success(t('Connected via browser as @{login}', { login: login ?? '?' }));
        void qc.invalidateQueries({ queryKey: ['connections'] });
        setTimeout(onClose, 1200);
      }
    },
    [qc, t, onClose],
  );

  // start the flow once
  useEffect(() => {
    let alive = true;
    api
      .deviceStart(provider)
      .then((s) => {
        if (!alive) return;
        setStart(s);
        setPhase('waiting');
      })
      .catch((e) => {
        if (!alive) return;
        setErrMsg((e as Error).message);
        setPhase('error');
      });
    return () => {
      alive = false;
    };
  }, [provider]);

  // poll loop
  useEffect(() => {
    if (phase !== 'waiting' || !start) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const r = await api.devicePoll(provider, start.sessionId);
        if (r.status === 'done') return finish(true, r.login);
        if (r.status === 'denied') return setPhase('denied');
        if (r.status === 'expired') return setPhase('expired');
        // pending → keep polling
        timerRef.current = setTimeout(tick, Math.max((start.interval ?? 5) * 1000, 3000));
      } catch {
        timerRef.current = setTimeout(tick, 5000);
      }
    };
    timerRef.current = setTimeout(tick, Math.max((start.interval ?? 5) * 1000, 3000));
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, start, provider, finish]);

  const copyCode = async () => {
    if (!start) return;
    try {
      await navigator.clipboard.writeText(start.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <Button variant="ghost" size="icon" className="absolute end-3 top-3 h-7 w-7" onClick={onClose} aria-label="close">
          <X className="h-4 w-4" />
        </Button>
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <MonitorSmartphone className="h-4 w-4 text-primary" />
          {t('Login with browser (Device Flow)')}
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          {t('A code is shown — enter it at github.com/login/device in your browser and authorize. This window polls automatically until you finish.')}
        </p>

        {phase === 'starting' && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> …
          </div>
        )}

        {(phase === 'waiting' || phase === 'done') && start && (
          <div className="space-y-4">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-center">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">one-time code</div>
              <div dir="ltr" className="select-all font-mono text-3xl font-bold tracking-[0.35em] text-primary">{start.userCode}</div>
              <Button variant="outline" size="sm" className="mt-3 h-7 border-border text-xs" onClick={copyCode}>
                {copied ? <CheckCircle2 className="me-1 h-3 w-3 text-primary" /> : <Copy className="me-1 h-3 w-3" />}
                {copied ? t('Copied') : t('Copy code')}
              </Button>
            </div>
            <Button asChild className="w-full bg-primary text-[#0b1512] hover:bg-primary/90">
              <a href={start.verificationUri} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="me-1.5 h-3.5 w-3.5" />
                {provider === 'github' ? t('Open github.com/login/device') : start.verificationUri}
              </a>
            </Button>
            {phase === 'waiting' ? (
              <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                {t('Waiting for authorization…')}
              </p>
            ) : (
              <p className="flex items-center justify-center gap-2 text-xs text-primary">
                <CheckCircle2 className="h-4 w-4" /> ✓
              </p>
            )}
            <p className="text-center text-[10px] leading-relaxed text-muted-foreground/70" dir="ltr">
              {start.verificationUri}
            </p>
          </div>
        )}

        {phase === 'denied' && <AlertBox tone="warn" msg={t('Authorization denied')} onRetry={onClose} retryLabel="OK" />}
        {phase === 'expired' && <AlertBox tone="warn" msg={t('Code expired — start again')} onRetry={onClose} retryLabel="OK" />}
        {phase === 'error' && <AlertBox tone="err" msg={errMsg ?? 'error'} onRetry={onClose} retryLabel="OK" />}
      </div>
    </div>
  );
}

function AlertBox({ tone, msg, onRetry, retryLabel }: { tone: 'warn' | 'err'; msg: string; onRetry: () => void; retryLabel: string }) {
  return (
    <div className="space-y-3 py-4 text-center">
      <p className={cn('text-sm leading-relaxed', tone === 'err' ? 'text-red-400' : 'text-amber-300')}>{msg}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>{retryLabel}</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SettingsView() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [ghToken, setGhToken] = useState('');
  const [glToken, setGlToken] = useState('');
  const [glUrl, setGlUrl] = useState('');
  const [liaraToken, setLiaraToken] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiBase, setAiBase] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [ghClientId, setGhClientId] = useState('');
  const [glClientId, setGlClientId] = useState('');
  const [glSecret, setGlSecret] = useState('');
  const [deviceModal, setDeviceModal] = useState<'github' | 'gitlab' | null>(null);

  const connQ = useQuery({ queryKey: ['connections'], queryFn: api.connections });
  const llmQ = useQuery({ queryKey: ['llm-status'], queryFn: api.llmStatus, refetchInterval: 30_000 });
  const oauthCfgQ = useQuery({ queryKey: ['oauth-app'], queryFn: api.oauthAppConfig });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['connections'] });
    void qc.invalidateQueries({ queryKey: ['llm-status'] });
    void qc.invalidateQueries({ queryKey: ['oauth-app'] });
  };

  const ghPat = useMutation({
    mutationFn: () => api.connectGithubPat(ghToken.trim()),
    onSuccess: (r) => {
      toast.success(t('GitHub connected'), { description: t('verified as @{login} — private repos of this account are now analyzable', { login: r.login }) });
      setGhToken('');
      invalidate();
    },
    onError: (e) => toast.error(t('GitHub connection failed'), { description: (e as Error).message }),
  });
  const ghUnlink = useMutation({ mutationFn: api.disconnectGithub, onSuccess: () => { toast.success(t('GitHub disconnected')); invalidate(); } });
  const glPat = useMutation({
    mutationFn: () => api.connectGitlabPat(glToken.trim(), glUrl.trim() || undefined),
    onSuccess: (r) => {
      toast.success(t('GitLab connected'), { description: t('verified as @{login} on {url}', { login: r.login, url: r.instanceUrl }) });
      setGlToken('');
      invalidate();
    },
    onError: (e) => toast.error(t('GitLab connection failed'), { description: (e as Error).message }),
  });
  const glUnlink = useMutation({ mutationFn: api.disconnectGitlab, onSuccess: () => { toast.success(t('GitLab disconnected')); invalidate(); } });
  const liaraConn = useMutation({
    mutationFn: () => api.connectLiara(liaraToken.trim()),
    onSuccess: (r) => {
      toast.success(t('Liara connected'), { description: r.accountEmail ?? undefined });
      setLiaraToken('');
      invalidate();
    },
    onError: (e) => toast.error(t('Liara connection failed'), { description: (e as Error).message }),
  });
  const liaraUnlink = useMutation({ mutationFn: api.disconnectLiara, onSuccess: () => { toast.success(t('Liara disconnected')); invalidate(); } });
  const aiSave = useMutation({
    mutationFn: (test: boolean) => api.saveAiSettings({ apiKey: aiKey.trim() || undefined, baseUrl: aiBase.trim() || undefined, model: aiModel.trim() || undefined, test }),
    onSuccess: (r) => {
      toast.success(t('AI connected ({model})', { model: r.model }));
      setAiKey('');
      invalidate();
    },
    onError: (e) => toast.error(t('AI endpoint test failed'), { description: (e as Error).message }),
  });
  const aiUnlink = useMutation({ mutationFn: api.deleteAiSettings, onSuccess: () => { toast.success(t('AI disconnected')); invalidate(); } });
  const oauthAppSave = useMutation({
    mutationFn: () =>
      api.saveOAuthAppConfig({
        githubClientId: ghClientId.trim() || undefined,
        gitlabClientId: glClientId.trim() || undefined,
        gitlabClientSecret: glSecret.trim() || undefined,
        gitlabInstanceUrl: glUrl.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(t('OAuth app config saved'));
      setGlSecret('');
      invalidate();
    },
  });

  const conn = connQ.data;
  const llm = llmQ.data;

  if (connQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold">{t('Settings & Connections')}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t('Every browser is its own private workspace — connect YOUR services below. Tokens are validated live against each provider, then stored AES-256-GCM encrypted. Nothing is read from environment variables.')}
        </p>
      </header>

      {deviceModal && <DeviceFlowModal provider={deviceModal} onClose={() => setDeviceModal(null)} />}

      {/* GitHub */}
      <CardShell
        icon={<Github className="h-4 w-4" />}
        title="GitHub"
        subtitle={t('Connect to analyze private repositories with your own token, and to unlock higher API rate limits.')}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusPill
            connected={Boolean(conn?.github)}
            via={conn?.github?.via}
            labels={{ notConnected: t('not connected'), connectedVia: t('connected · via {via}'), pat: t('pat'), oauth: t('oauth') }}
          />
          {conn?.github?.login && (
            <span className="text-xs text-muted-foreground" dir="ltr">@{conn.github.login} · {conn.github.tokenMask}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-primary/40 text-primary hover:bg-primary/10"
            onClick={() => setDeviceModal('github')}
          >
            <MonitorSmartphone className="me-1.5 h-3.5 w-3.5" /> {t('Login with browser (Device Flow)')}
          </Button>
        </div>
        {!conn?.appConfig.githubDevice && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300/90">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            {t('Browser login requires the OAuth App Client ID to be saved once for this deployment (Settings → OAuth App). Until then, a Personal Access Token works right now.')}
          </p>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="gh-pat" className="sr-only">GitHub personal access token</Label>
            <Input
              id="gh-pat"
              type="password"
              dir="ltr"
              placeholder="ghp_… / github_pat_… (scopes: repo, read:user)"
              value={ghToken}
              onChange={(e) => setGhToken(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!ghToken.trim() || ghPat.isPending} onClick={() => ghPat.mutate()} className="bg-primary text-[#0b1512] hover:bg-primary/90">
              {ghPat.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="me-1.5 h-3.5 w-3.5" />}
              {t('Connect token')}
            </Button>
            {conn?.github && (
              <Button size="sm" variant="outline" disabled={ghUnlink.isPending} onClick={() => ghUnlink.mutate()}>
                <Unlink className="me-1.5 h-3.5 w-3.5" /> {t('Disconnect')}
              </Button>
            )}
          </div>
        </div>
      </CardShell>

      {/* GitLab */}
      <CardShell
        icon={<GitLabMark className="h-4 w-4" />}
        title="GitLab"
        subtitle={t('gitlab.com or any self-hosted instance. Personal access token needs read_api (or api) scope.')}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusPill
            connected={Boolean(conn?.gitlab)}
            via={conn?.gitlab?.via}
            labels={{ notConnected: t('not connected'), connectedVia: t('connected · via {via}'), pat: t('pat'), oauth: t('oauth') }}
          />
          {conn?.gitlab?.login && (
            <span className="text-xs text-muted-foreground" dir="ltr">
              @{conn.gitlab.login} · {conn.gitlab.instanceUrl} · {conn.gitlab.tokenMask}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-primary/40 text-primary hover:bg-primary/10"
            onClick={() => setDeviceModal('gitlab')}
          >
            <MonitorSmartphone className="me-1.5 h-3.5 w-3.5" /> {t('Login with browser (Device Flow)')}
          </Button>
        </div>
        {!conn?.appConfig.gitlabDevice && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300/90">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            {t('Browser login requires the OAuth App Client ID to be saved once for this deployment (Settings → OAuth App). Until then, a Personal Access Token works right now.')}
          </p>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="gl-url" className="sr-only">GitLab instance URL</Label>
            <Input id="gl-url" dir="ltr" placeholder="https://gitlab.com (or your instance)" value={glUrl} onChange={(e) => setGlUrl(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gl-pat" className="sr-only">GitLab personal access token</Label>
            <Input
              id="gl-pat"
              type="password"
              dir="ltr"
              placeholder="glpat-… (scope: read_api)"
              value={glToken}
              onChange={(e) => setGlToken(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!glToken.trim() || glPat.isPending} onClick={() => glPat.mutate()} className="bg-primary text-[#0b1512] hover:bg-primary/90">
              {glPat.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="me-1.5 h-3.5 w-3.5" />}
              {t('Connect token')}
            </Button>
            {conn?.gitlab && (
              <Button size="sm" variant="outline" disabled={glUnlink.isPending} onClick={() => glUnlink.mutate()}>
                <Unlink className="me-1.5 h-3.5 w-3.5" /> {t('Disconnect')}
              </Button>
            )}
          </div>
        </div>
      </CardShell>

      {/* Liara */}
      <CardShell
        icon={<PlugZap className="h-4 w-4" />}
        title={t('Liara platform')}
        subtitle={t('Paste an API token from console.liara.ir (API Keys menu). The agent uses it for REAL operations on YOUR apps: deploy, restart, scale, logs.')}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {conn?.liara ? (
            <Badge className="border-transparent bg-primary/15 text-primary">
              <CheckCircle2 className="me-1 h-3 w-3" /> {t('Liara connected as {account}', { account: conn.liara.accountEmail ?? conn.liara.tokenMask })}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-400/30 text-amber-300">{t('not connected')}</Badge>
          )}
          <a
            href="https://console.liara.ir/panel/api-keys"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:underline"
            dir="ltr"
          >
            console.liara.ir/panel/api-keys <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="liara-token" className="sr-only">{t('Liara API token')}</Label>
            <Input
              id="liara-token"
              type="password"
              dir="ltr"
              placeholder="eyJhbGciOi… (API token from Liara Console)"
              value={liaraToken}
              onChange={(e) => setLiaraToken(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!liaraToken.trim() || liaraConn.isPending} onClick={() => liaraConn.mutate()} className="bg-primary text-[#0b1512] hover:bg-primary/90">
              {liaraConn.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="me-1.5 h-3.5 w-3.5" />}
              {t('Connect token')}
            </Button>
            {conn?.liara && (
              <Button size="sm" variant="outline" disabled={liaraUnlink.isPending} onClick={() => liaraUnlink.mutate()}>
                <Unlink className="me-1.5 h-3.5 w-3.5" /> {t('Disconnect')}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
          {t('Get token from Liara Console')}: Panel → API → ساخت کلید جدید. {t('The token is validated live against api.liara.ir before it is stored.')}
        </p>
      </CardShell>

      {/* AI */}
      <CardShell
        icon={<Brain className="h-4 w-4" />}
        title={t('AI (ChatGPT / OpenAI-compatible)')}
        subtitle={t('Bring your own key: OpenAI, Azure OpenAI, OpenRouter, or any OpenAI-compatible endpoint. Used for chat replies, incident diagnosis and deploy reports.')}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {llm ? (
            <>
              <Badge className={cn('border-transparent', llm.provider === 'chatgpt' ? 'bg-primary/15 text-primary' : llm.provider === 'zai' ? 'bg-sky-400/15 text-sky-300' : 'border-amber-400/30 text-amber-300')}>
                {llm.provider === 'chatgpt' ? <Bot className="me-1 h-3 w-3" /> : <PlugZap className="me-1 h-3 w-3" />}
                {llm.provider === 'chatgpt' ? t('ChatGPT ({model}) is answering', { model: llm.model ?? '' }) : llm.provider === 'zai' ? t('Built-in z-ai model answering — connect your own AI key in Settings') : t('No AI connected — connect your own AI key in Settings')}
              </Badge>
              {conn?.ai && <Badge variant="outline" className="text-[10px] text-muted-foreground" dir="ltr">{conn.ai.keyMask} · {conn.ai.model}</Badge>}
            </>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="ai-key" className="text-xs">{t('API key')}</Label>
            <Input id="ai-key" type="password" dir="ltr" placeholder="sk-… (leave empty to keep the saved key)" value={aiKey} onChange={(e) => setAiKey(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-model" className="text-xs">{t('Model')}</Label>
            <Input id="ai-model" dir="ltr" placeholder="gpt-4o-mini" value={aiModel} onChange={(e) => setAiModel(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ai-base" className="text-xs">{t('Base URL')}</Label>
            <Input id="ai-base" dir="ltr" placeholder="https://api.openai.com/v1" value={aiBase} onChange={(e) => setAiBase(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={aiSave.isPending} onClick={() => aiSave.mutate(true)} className="bg-primary text-[#0b1512] hover:bg-primary/90">
            {aiSave.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="me-1.5 h-3.5 w-3.5" />}
            {t('Save & test')}
          </Button>
          <Button size="sm" variant="outline" disabled={aiSave.isPending} onClick={() => aiSave.mutate(false)}>
            {t('Save without test')}
          </Button>
          {conn?.ai && (
            <Button size="sm" variant="outline" disabled={aiUnlink.isPending} onClick={() => aiUnlink.mutate()}>
              <Unlink className="me-1.5 h-3.5 w-3.5" /> {t('Disconnect')}
            </Button>
          )}
        </div>
      </CardShell>

      {/* OAuth App registration (deployment-wide, enables browser login) */}
      <CardShell
        icon={<MonitorSmartphone className="h-4 w-4" />}
        title={t('Set up OAuth App (client IDs)')}
        subtitle={t('One-time setup for this deployment — enables "login with browser" for every visitor without any env vars:')}
      >
        <ol className="mb-4 list-inside list-decimal space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <li>{t('GitHub OAuth App → github.com/settings/developers → New OAuth App → enable Device Flow → copy the Client ID.')}</li>
          <li>{t('GitLab: your-instance → User Settings → Applications → new app with read_api scope + Device Authorization Grant → copy the Application ID.')}</li>
          <li>{t('Client IDs are public by design — no secret is needed for GitHub Device Flow.')}</li>
        </ol>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="gh-cid" className="text-xs">GitHub Client ID</Label>
            <Input id="gh-cid" dir="ltr" placeholder={oauthCfgQ.data?.githubClientId ?? 'Iv1.xxxxxxxxxxxx / Ov23li…'} value={ghClientId} onChange={(e) => setGhClientId(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gl-cid" className="text-xs">GitLab Application ID</Label>
            <Input id="gl-cid" dir="ltr" placeholder={oauthCfgQ.data?.gitlabClientId ?? 'xxxxxxxxxxxxxxxxxxxx'} value={glClientId} onChange={(e) => setGlClientId(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gl-inst" className="text-xs">GitLab instance</Label>
            <Input id="gl-inst" dir="ltr" placeholder={oauthCfgQ.data?.gitlabInstanceUrl ?? 'https://gitlab.com'} value={glUrl} onChange={(e) => setGlUrl(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gl-sec" className="text-xs">GitLab secret (optional)</Label>
            <Input id="gl-sec" type="password" dir="ltr" placeholder={oauthCfgQ.data?.hasGitlabSecret ? '•••• saved' : 'glscb_… (confidential apps)'} value={glSecret} onChange={(e) => setGlSecret(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <Button size="sm" className="mt-3 bg-primary text-[#0b1512] hover:bg-primary/90" disabled={oauthAppSave.isPending} onClick={() => oauthAppSave.mutate()}>
          {oauthAppSave.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="me-1.5 h-3.5 w-3.5" />}
          {t('Save OAuth app config')}
        </Button>
      </CardShell>
    </div>
  );
}
