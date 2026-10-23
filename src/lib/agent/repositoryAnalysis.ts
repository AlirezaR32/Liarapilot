// Repository intelligence (spec §6): targeted file retrieval, deterministic
// classification, structured ProjectProfile with evidence + confidence.
// Deterministic code, no LLM — per spec ("Prefer deterministic code over LLM
// calls for predictable tasks").

import {
  type RepoFile,
} from '@/lib/integrations/github/client';
import { getRepoSource, isRepoProvider, type RepoProvider } from '@/lib/integrations/repoSource';
import { extractEnvVarNames } from '@/lib/security/redaction';
import { ProjectProfile, type ProjectProfile as ProjectProfileT } from '@/lib/types';

// ---------------------------------------------------------------------------
// Which files we care about (targeted reads, never whole-repo)
// ---------------------------------------------------------------------------

const IMPORTANT_FILES = [
  'README.md',
  'readme.md',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'Pipfile',
  'go.mod',
  'Gemfile',
  'composer.json',
  'Dockerfile',
  '.dockerignore',
  'docker-compose.yml',
  'liara.json',
  'Procfile',
  '.env.example',
  '.env.sample',
  'nixpacks.toml',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  'liarapilot.skip', // sentinel: repo asks the agent to leave it alone
];

const MAX_CONCURRENT_HINTS = 8;

interface ManifestInfo {
  language: string | null;
  framework: string | null;
  packageManager: ProjectProfileT['packageManager'];
  buildCommand: string | null;
  startCommand: string | null;
  appPort: number | null;
  languageVersion: string | null;
}

function classifyPackageManager(rootFiles: Set<string>): ProjectProfileT['packageManager'] {
  if (rootFiles.has('pnpm-lock.yaml')) return 'pnpm';
  if (rootFiles.has('yarn.lock')) return 'yarn';
  if (rootFiles.has('bun.lockb')) return 'bun';
  if (rootFiles.has('package-lock.json')) return 'npm';
  if (rootFiles.has('poetry.lock')) return 'poetry';
  if (rootFiles.has('requirements.txt') || rootFiles.has('pyproject.toml')) return 'pip';
  return 'unknown';
}

function detectFrameworkFromDeps(deps: Record<string, string>): string | null {
  if (deps['next']) return 'Next.js';
  if (deps['nuxt']) return 'Nuxt';
  if (deps['@remix-run/serve']) return 'Remix';
  if (deps['astro']) return 'Astro';
  if (deps['@nestjs/core']) return 'NestJS';
  if (deps['@angular/core']) return 'Angular';
  if (deps['react']) return 'React';
  if (deps['vue']) return 'Vue';
  if (deps['express']) return 'Express';
  if (deps['fastify']) return 'Fastify';
  if (deps['koa']) return 'Koa';
  if (deps['hono']) return 'Hono';
  if (deps['django']) return 'Django';
  if (deps['flask']) return 'Flask';
  if (deps['fastapi']) return 'FastAPI';
  return null;
}

function parseNodeManifest(content: string): ManifestInfo | null {
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };
    const engines = (pkg.engines ?? {}) as Record<string, string>;
    const startCommand = scripts.start ?? null;
    const buildCommand = scripts.build ?? null;
    // port hint: common patterns in start scripts or PORT default
    let appPort: number | null = null;
    for (const s of [scripts.start, scripts.dev]) {
      const m = /(?:PORT\s*=\s*|--port\s*|-p\s*)?(\d{4,5})/.exec(s ?? '');
      const n = m ? Number(m[1]) : NaN;
      if (!Number.isNaN(n) && n > 0 && n < 65536) {
        appPort = n;
        break;
      }
    }
    return {
      language: 'JavaScript/TypeScript',
      framework: detectFrameworkFromDeps(deps),
      packageManager: null, // set by lockfile classification
      buildCommand,
      startCommand,
      appPort,
      languageVersion: engines.node ?? null,
    };
  } catch {
    return null;
  }
}

function parsePythonManifest(content: string, filename: string): ManifestInfo {
  let framework: string | null = null;
  let startCommand: string | null = null;
  const deps = content.toLowerCase();
  if (deps.includes('fastapi')) framework = 'FastAPI';
  else if (deps.includes('django')) framework = 'Django';
  else if (deps.includes('flask')) framework = 'Flask';
  if (framework === 'FastAPI') startCommand = 'uvicorn main:app --host 0.0.0.0 --port $PORT';
  else if (framework === 'Flask') startCommand = 'gunicorn app:app';
  else if (framework === 'Django') startCommand = 'gunicorn myproject.wsgi';
  void filename;
  return {
    language: 'Python',
    framework,
    packageManager: null,
    buildCommand: null,
    startCommand,
    appPort: null,
    languageVersion: null,
  };
}

function parseDockerfile(content: string): ManifestInfo {
  const expose = /^\s*EXPOSE\s+(\d{2,5})/im.exec(content);
  const cmd = /^\s*CMD\s+(.+)$/im.exec(content);
  const node = /node:(\d+)/i.exec(content);
  return {
    language: node ? 'JavaScript/TypeScript' : null,
    framework: null,
    packageManager: null,
    buildCommand: null,
    startCommand: cmd ? cmd[1].replace(/["[\]]/g, '').trim() : null,
    appPort: expose ? Number(expose[1]) : null,
    languageVersion: node ? `>=${node[1]}` : null,
  };
}

// ---------------------------------------------------------------------------

export class AnalysisBlockedError extends Error {}

export interface AnalyzeOptions {
  branch?: string;
  provider?: RepoProvider | string; // "github" (default) | "gitlab"
  userId?: string; // resolves the user's OWN connected token (public repos work without)
  signal?: AbortSignal;
}

/**
 * Analyze a repository into a validated ProjectProfile — always REAL reads
 * against the provider API (GitHub or GitLab) with the user's own connected
 * token when present (public repos work tokenless).
 */
export async function analyzeRepository(
  ref: { owner: string; repo: string },
  opts: AnalyzeOptions = {},
): Promise<ProjectProfileT> {
  const provider: RepoProvider = isRepoProvider(opts.provider) ? opts.provider : 'github';
  const source = await getRepoSource(provider, opts.userId ?? 'system');

  const meta = await source.meta(ref, opts.signal);
  const rootFiles = await source.rootListing(ref, opts.branch ?? meta.defaultBranch, opts.signal);
  const rootSet = new Set(rootFiles);

  if (rootSet.has('liarapilot.skip')) {
    throw new AnalysisBlockedError('Repository contains liarapilot.skip — analysis disabled by repo owner.');
  }

  // bounded commit lookup
  const commit = await source.latestCommit(ref, opts.branch ?? meta.defaultBranch, opts.signal);

  const wanted = IMPORTANT_FILES.filter((f) => rootSet.has(f));
  const files: RepoFile[] = await source.files(ref, wanted.slice(0, MAX_CONCURRENT_HINTS), opts.branch ?? meta.defaultBranch, opts.signal);

  const byPath = new Map(files.map((f) => [f.path, f]));
  const evidence: ProjectProfileT['evidence'] = [];
  const blockers: string[] = [];
  const limitations: string[] = [];
  const buildRequirements: string[] = [];

  // --- manifests -----------------------------------------------------------
  let info: ManifestInfo = {
    language: null,
    framework: null,
    packageManager: classifyPackageManager(rootSet),
    buildCommand: null,
    startCommand: null,
    appPort: null,
    languageVersion: null,
  };

  const pkgJson = byPath.get('package.json');
  const pyReq = byPath.get('requirements.txt');
  const pyProject = byPath.get('pyproject.toml');
  const goMod = byPath.get('go.mod');
  const dockerfile = byPath.get('Dockerfile');

  if (pkgJson?.content) {
    const parsed = parseNodeManifest(pkgJson.content);
    if (parsed) {
      info = {
        ...parsed,
        packageManager: classifyPackageManager(rootSet) === 'unknown' ? 'npm' : classifyPackageManager(rootSet),
      };
      evidence.push({ file: 'package.json', field: 'language/framework/scripts', detail: `مانیفست Node؛ اسکریپت‌ها: build=${parsed.buildCommand ?? '—'}، start=${parsed.startCommand ?? '—'}` });
      if (info.languageVersion) evidence.push({ file: 'package.json', field: 'languageVersion', detail: `engines.node ${info.languageVersion}` });
    }
  } else if (pyReq?.content || pyProject?.content) {
    info = parsePythonManifest((pyReq?.content ?? '') + (pyProject?.content ?? ''), pyReq ? 'requirements.txt' : 'pyproject.toml');
    evidence.push({ file: pyReq ? 'requirements.txt' : 'pyproject.toml', field: 'language/framework', detail: `پروژهٔ Python${info.framework ? ` (${info.framework})` : ''}` });
  } else if (goMod?.content) {
    info = { ...info, language: 'Go', packageManager: null, startCommand: null };
    evidence.push({ file: 'go.mod', field: 'language', detail: 'ماژول Go تشخیص داده شد' });
  }

  if (dockerfile?.content) {
    const d = parseDockerfile(dockerfile.content);
    info = {
      language: info.language ?? d.language,
      framework: info.framework ?? d.framework,
      packageManager: info.packageManager,
      buildCommand: info.buildCommand ?? d.buildCommand,
      startCommand: info.startCommand ?? d.startCommand,
      appPort: info.appPort ?? d.appPort,
      languageVersion: info.languageVersion ?? d.languageVersion,
    };
    evidence.push({ file: 'Dockerfile', field: 'deployment/start/port', detail: `ایمیج Docker موجود است؛ EXPOSE=${d.appPort ?? '—'}، CMD=${d.startCommand ?? '—'}` });
  }

  if (info.startCommand && info.startCommand.includes('tsc')) {
    buildRequirements.push('کامپایل TypeScript قبل از اجرا لازم است');
  }

  // --- Liara manifest -------------------------------------------------------
  const liaraManifest = byPath.get('liara.json');
  let liaraPlatform: string | null = null;
  if (liaraManifest?.content) {
    try {
      const lm = JSON.parse(liaraManifest.content) as Record<string, unknown>;
      liaraPlatform = lm.platform ? String(lm.platform) : null;
      if (typeof lm.port === 'number') info.appPort = lm.port;
      evidence.push({ file: 'liara.json', field: 'deployment', detail: `مانیفست لیارا موجود است${liaraPlatform ? ` (پلتفرم: ${liaraPlatform})` : ''}` });
    } catch {
      limitations.push('liara.json هست اما JSON معتبر نیست');
    }
  }

  // --- env requirements (names only; values never leave this function) ------
  const envExample = byPath.get('.env.example') ?? byPath.get('.env.sample');
  const requiredEnvVars = envExample?.content
    ? extractEnvVarNames(envExample.content).map((v) => ({
        name: v.name,
        required: v.required,
        source: envExample.path,
        note: undefined as string | undefined,
      }))
    : [];
  if (envExample?.content) {
    evidence.push({ file: envExample.path, field: 'requiredEnvVars', detail: `${requiredEnvVars.length} نام متغیر محیطی استخراج شد (مقدارها نادیده گرفته شد)` });
  }

  // --- README summary (deterministic excerpt, no LLM) ------------------------
  const readme = byPath.get('README.md') ?? byPath.get('readme.md');
  let readmeSummary: string | null = null;
  if (readme?.content) {
    const firstLines = readme.content
      .split(/\r?\n/)
      .filter((l) => !l.startsWith('!['))
      .slice(0, 12)
      .join('\n')
      .slice(0, 900);
    readmeSummary = firstLines;
    evidence.push({ file: readme.path, field: 'readmeSummary', detail: 'گزیده برای زمینه ذخیره شد (محتوای غیرمعتبر؛ هرگز اجرا نمی‌شود)' });
  }

  // --- deployment candidates -------------------------------------------------
  const candidates: ProjectProfileT['deploymentCandidates'] = [];
  if (dockerfile?.content) {
    candidates.push({
      method: 'dockerfile_cli',
      platform: liaraPlatform ?? 'docker',
      rationale: 'مخزن داکرفایل دارد؛ پلتفرم Docker لیارا مستقیماً آن را بیلد می‌کند.',
      confidence: 'high',
    });
  }
  if (pkgJson?.content) {
    candidates.push({
      method: 'liara_cli_deploy',
      platform: liaraPlatform ?? 'node',
      rationale: 'پروژهٔ Node.js با package.json؛ بیلدپک Node لیارا می‌تواند بسازد و اجرا کند.',
      confidence: pkgJson.content && info.startCommand ? 'high' : 'medium',
    });
  }
  if (!candidates.length && (pyReq?.content || pyProject?.content)) {
    candidates.push({
      method: 'liara_cli_deploy',
      platform: liaraPlatform ?? 'python',
      rationale: 'پروژهٔ Python تشخیص داده شد؛ بیلدپک Python لیارا کاندید است (پشتیبانی پلتفرم را راستی‌آزمایی کنید).',
      confidence: 'medium',
    });
  }
  if (!candidates.length) {
    blockers.push('هیچ راهبرد استقرار پشتیبانی‌شده‌ای شناسایی نشد (نه داکرفایل، نه package.json، نه مانیفست Python).');
    candidates.push({ method: 'unsupported', platform: null, rationale: 'مانیفست قابل‌تشخیصی وجود ندارد.', confidence: 'high' });
  }

  // --- blockers ---------------------------------------------------------------
  if (!info.startCommand && !dockerfile?.content) {
    blockers.push('دستور اجرا مشخص نشد (نه CMD در داکرفایل، نه اسکریپت start).');
  }
  const missingRequiredEnv = requiredEnvVars.filter((v) => v.required).map((v) => v.name);

  const profile: ProjectProfileT = {
    repository: meta.fullName,
    defaultBranch: meta.defaultBranch,
    analyzedSha: commit?.sha ?? null,
    language: info.language,
    languageVersion: info.languageVersion,
    framework: info.framework,
    packageManager: info.packageManager && info.packageManager !== 'unknown' ? info.packageManager : null,
    buildCommand: info.buildCommand,
    startCommand: info.startCommand,
    appPort: info.appPort,
    deploymentCandidates: candidates,
    requiredEnvVars,
    configFiles: files.map((f) => f.path),
    buildRequirements,
    hasDockerfile: Boolean(dockerfile?.content),
    hasLiaraManifest: Boolean(liaraManifest?.content),
    isDeployable: candidates.some((c) => c.method !== 'unsupported') && blockers.filter((b) => b.includes('start command') || b.includes('No supported')).length === 0,
    blockers,
    knownLimitations: limitations,
    readmeSummary,
    evidence,
    analyzedAt: new Date().toISOString(),
  };
  void missingRequiredEnv; // surfaced via requiredEnvVars.required

  const parsed = ProjectProfile.safeParse(profile);
  if (!parsed.success) {
    throw new Error(`internal: generated profile failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Config files that should invalidate the analysis cache when changed. */
export const CACHE_RELEVANT_FILES = IMPORTANT_FILES;
