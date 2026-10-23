'use client';

// Guide view: step-by-step Liara deployment tutorial (Persian-first).
// Commercial flow: ZERO environment variables — services are connected inside
// the app after deployment (browser Device-Flow login for GitHub/GitLab,
// Liara API token, user's own AI key). Includes real pitfalls collected from
// live deploy sessions (disk order, envs wipe, OOM, CLI bug).
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber, useI18n } from '@/lib/i18n';
import {
  AlertTriangle, Bot, Check, ClipboardCopy, Cloud, Database, ExternalLink,
  FolderGit2, KeyRound, MonitorSmartphone, PlugZap, Rocket, ServerCog, ShieldCheck,
  Stethoscope, Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function CopyBtn({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="absolute end-2 top-2 rounded-md border border-border bg-background/80 p-1.5 text-muted-foreground backdrop-blur transition-colors hover:border-primary/40 hover:text-primary"
      aria-label={t('Copy command')}
      title={t('Copy command')}
    >
      {done ? <Check className="h-3.5 w-3.5 text-primary" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Cmd({ cmd }: { cmd: string }) {
  return (
    <div className="relative mt-2.5">
      <pre dir="ltr" className="overflow-x-auto rounded-lg border border-border bg-[#0a100e] p-3 pe-10 text-left font-mono text-[11.5px] leading-relaxed text-[#b8e8d2]">
        {cmd}
      </pre>
      <CopyBtn text={cmd} />
    </div>
  );
}

function Step({ n, icon: Icon, title, children }: { n: number; icon: typeof Rocket; title: string; children: React.ReactNode }) {
  return (
    <Card className="relative overflow-hidden">
      <div aria-hidden className="absolute inset-y-0 start-0 w-1 liara-gradient opacity-60" />
      <CardHeader className="pb-2 ps-5">
        <CardTitle className="flex items-center gap-3 text-sm font-bold">
          <span className="liara-gradient liara-glow flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base font-extrabold text-[#0b1512]">
            {n}
          </span>
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="ps-5 text-[13px] leading-7 text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

function Callout({ tone, title, children }: { tone: 'warn' | 'info'; title: string; children: React.ReactNode }) {
  return (
    <div className={cn(
      'rounded-lg border p-3 text-xs leading-6',
      tone === 'warn' ? 'border-amber-400/30 bg-amber-400/10 text-amber-200/90' : 'border-sky-400/30 bg-sky-400/10 text-sky-200/90',
    )}>
      <p className="flex items-center gap-1.5 font-bold">
        <AlertTriangle className={cn('h-3.5 w-3.5', tone === 'info' && 'text-sky-300')} />
        {title}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function GuideView() {
  const { t, locale } = useI18n();
  const fa = locale === 'fa';

  const checklist = [
    t('Open the app URL — the Persian RTL workspace loads without a login screen'),
    t('Settings → connect GitHub via browser (or PAT) — the masked account appears'),
    t('Settings → paste your Liara API token — it is validated live against api.liara.ir'),
    t('Connect a repository — analysis runs and the deploy plan is written in Persian'),
    t('Ask a question in Chat — the answer cites real evidence'),
    t('Approve the deployment from the Approvals view and watch live progress'),
    t('Health check shows healthy and the Liara app link opens'),
    t('Switch language to English and back — layout flips LTR/RTL cleanly'),
  ];

  return (
    <div className="space-y-5">
      {/* hero */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/25 p-6 sm:p-8">
        <div aria-hidden className="absolute inset-0 -z-10 liara-gradient opacity-[0.07]" />
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
          <Cloud className="h-4 w-4" /> {t('Liara deployment guide')}
        </p>
        <h2 className="mt-2 text-xl font-extrabold leading-relaxed sm:text-2xl">
          {t('Take LiaraPilot live on the Liara platform — in seven guided steps')}
        </h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-7 text-muted-foreground">
          {t('The project ships with liara.json, a multi-stage Dockerfile and an idempotent entrypoint (automatic prisma db push). Deployment needs ZERO environment variables — every service is connected inside the app afterwards, per browser workspace.')}
        </p>
      </div>

      {/* steps */}
      <div className="space-y-4">
        <Step n={1} icon={Terminal} title={t('Log in to the Liara CLI')}>
          {t('Create an API key in the Liara Console (Panel → API → build new key), then log in locally. This is only for running the deploy from YOUR machine — the deployed agent never needs this token.')}
          <Cmd cmd={'npm i -g @liara/cli\nliara login --api-token <YOUR_API_TOKEN>'} />
        </Step>

        <Step n={2} icon={Database} title={t('Create the persistent disk (before the first deploy)')}>
          {t('SQLite needs a persistent disk mounted at /app/data. Create it once — it must exist before the first deployment, otherwise the deploy fails with “Disk does not exist”.')}
          <Cmd cmd={'liara disk create liarapilot-data -a <APP_NAME> --size 1'} />
          <Callout tone="info" title={t('Why before the first deploy?')}>
            {t('Disk creation and first deploy are order-sensitive: the mount must exist when the platform starts your container. Re-running this command is safe; skip it if the disk already exists.')}
          </Callout>
        </Step>

        <Step n={3} icon={Rocket} title={t('Deploy — no env vars needed')}>
          {t('Easiest path: the guided graphical script (8 phases: preflight → login → disk → confirm → deploy with live build logs → health polling → success card). Direct CLI also works — liara deploy auto-creates the app on first run.')}
          <Cmd cmd={'bash scripts/deploy.sh\n# or directly:\nliara deploy -a <APP_NAME> -b iran -m'} />
          <Callout tone="info" title={t('Zero-environment deployment')}>
            {t('Nothing to configure here: DATABASE_URL is injected by the entrypoint, encryption keys are auto-generated on the data disk, and ALL service tokens (GitHub/GitLab/Liara/AI) are entered by each user inside the app.')}
          </Callout>
          <Callout tone="warn" title={t('Two known pitfalls')}>
            {fa ? (
              <>
                ۱) <code dir="ltr" className="rounded bg-black/30 px-1">liara app create</code> در CLI ۹.۶ با خطای <code dir="ltr" className="rounded bg-black/30 px-1">Invalid count value: -1</code> مواجه می‌شود — نیازی به آن نیست؛ <code dir="ltr" className="rounded bg-black/30 px-1">liara deploy</code> خودش اپ را می‌سازد. ۲) اگر بیلد روی پلن کوچک با کمبود حافظه (OOM) قطع شد، پلن را ارتقا دهید یا کش بیلد را خالی کنید.
              </>
            ) : (
              <>
                1) <code dir="ltr" className="rounded bg-black/30 px-1">liara app create</code> hits “Invalid count value: -1” on CLI 9.6 — skip it; <code dir="ltr" className="rounded bg-black/30 px-1">liara deploy</code> creates the app automatically. 2) If the build dies from OOM on a small plan, upgrade the plan or clear the build cache.
              </>
            )}
          </Callout>
          <Callout tone="warn" title={t('Warning: the “envs” key in liara.json wipes variables')}>
            {t('Do not manage variables through liara.json “envs” — a deploy with that key replaces ALL existing variables. LiaraPilot does not need any; if you add your own later, always use “liara env set”.')}
          </Callout>
        </Step>

        <Step n={4} icon={Stethoscope} title={t('Verify: health check and live logs')}>
          {t('The container pushes the DB schema on first boot (automatic prisma db push), then the built-in health endpoint answers. Watch colorized logs at any time.')}
          <Cmd cmd={'curl https://<APP_NAME>.liara.run/api/health\nliara app logs -f -a <APP_NAME>   # or: bash scripts/logs.sh'} />
        </Step>

        <Step n={5} icon={PlugZap} title={t('Connect your services inside the app (Settings)')}>
          {t('Open the deployed app, go to Settings and connect the services — each visitor connects their own:')}
          <ol className="mt-2 list-inside list-decimal space-y-1.5">
            <li>{t('GitHub — “Login with browser” shows a one-time code at github.com/login/device; or paste a PAT with the repo scope.')}</li>
            <li>{t('GitLab — the same browser flow on your instance; or a PAT with read_api scope.')}</li>
            <li>{t('Liara — paste an API token from console.liara.ir/panel/api-keys; it is validated live against api.liara.ir (GET /v1/me) and stored encrypted. This enables REAL deploys on your apps.')}</li>
            <li>{t('AI — any OpenAI-compatible key (OpenAI, Azure, OpenRouter…). Powers chat, incident diagnosis and deploy reports.')}</li>
          </ol>
          <Callout tone="info" title={t('Privacy model')}>
            {t('Every browser is its own private workspace; tokens are validated against each provider and stored AES-256-GCM encrypted with a key auto-generated on your data disk. Nothing is shared between visitors and nothing lives in env vars.')}
          </Callout>
        </Step>

        <Step n={6} icon={FolderGit2} title={t('Deploy YOUR repositories from inside the app')}>
          {t('Open «Repositories», pick one of YOUR GitHub/GitLab repos and hit «Connect & deploy». The pipeline pauses at the approval gate — after you approve, the agent downloads the repo at that exact revision, builds it on Liara (auto-creating the app on the cheapest plan when needed) and shows your final link.')}
          <ul className="mt-2 list-inside list-disc space-y-1.5">
            <li>{t('Live build logs stream into the progress card while Liara builds — no guessing about what went wrong.')}</li>
            <li>{t('The agent writes a minimal liara.json (detected platform) only when the repo has none — your own liara.json always wins.')}</li>
            <li>{t('After success the project page shows the live link with copy/open buttons — monitoring probes it automatically.')}</li>
          </ul>
        </Step>

        <Step n={7} icon={MonitorSmartphone} title={t('Optional: register the OAuth App (enables browser login for everyone)')}>
          {t('“Login with browser” uses the OAuth Device Flow and needs a Client ID registered once by the deployment owner:')}
          <ol className="mt-2 list-inside list-decimal space-y-1.5">
            <li>{t('GitHub: github.com/settings/developers → New OAuth App (any homepage URL) → create → enable Device Flow → copy the Client ID.')}</li>
            <li>{t('GitLab: User Settings → Applications → new app with read_api scope + Device Authorization Grant → copy the Application ID (secret only for confidential apps).')}</li>
            <li>{t('Paste them in Settings → “Set up OAuth App (client IDs)” and save — done, no restart, no env vars.')}</li>
          </ol>
          <Callout tone="info" title={t('Why Client ID and not a secret?')}>
            {t('The Device Flow is designed for public clients: only the Client ID is required for GitHub; user authorization happens on github.com and the token is delivered back to the app directly.')}
          </Callout>
        </Step>
      </div>

      {/* AI section */}
      <Card className="border-primary/25">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Bot className="h-4 w-4 text-primary" />
            {t('Where the AI makes decisions')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-[13px] leading-7 text-muted-foreground">
          <p>{t('The workflow itself is deterministic: evidence collection, planning and execution follow fixed rules. The LLM only reasons over bounded evidence — and its output always passes the human approval gate before anything runs.')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { icon: Bot, title: t('Chat & answers'), desc: t('Answers chat questions grounded in logs, health and repository evidence') },
              { icon: Stethoscope, title: t('Incident diagnosis'), desc: t('Root-cause analysis from the collected evidence, written in Persian') },
              { icon: ServerCog, title: t('Deploy reports'), desc: t('Summarizes each run: what happened, risks, next steps') },
            ].map((r) => (
              <div key={r.title} className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-foreground"><r.icon className="h-3.5 w-3.5 text-primary" />{r.title}</p>
                <p className="mt-1 text-[11px] leading-6">{r.desc}</p>
              </div>
            ))}
          </div>
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="border-primary/40 text-primary"><ShieldCheck className="me-1 h-3 w-3" />{t('bring your own key')}</Badge>
            <span dir="ltr" className="font-mono text-[11px] text-foreground/80">gpt-4o-mini · api.openai.com/v1</span>
            <span>{t('— defaults are pre-filled; every OpenAI-compatible endpoint works (Azure, OpenRouter, local vLLM…)')}</span>
          </p>
        </CardContent>
      </Card>

      {/* checklist */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Check className="h-4 w-4 text-primary" />
            {t('Post-deploy test checklist')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px] leading-7 text-muted-foreground">
                <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-[10px] font-bold text-primary">
                  {formatNumber(i + 1, locale)}
                </span>
                {item}
              </li>
            ))}
          </ol>
          <a
            href="https://docs.liara.ir"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-300 hover:text-sky-200"
          >
            {t('Full Liara platform docs')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
