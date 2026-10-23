// GitHub REST integration — targeted, bounded reads only (spec §6).
// Public repos work unauthenticated; the user's OWN connected token (PAT or
// browser Device-Flow OAuth) unlocks private repos — never an env token.

const API = 'https://api.github.com';
const MAX_FILE_BYTES = 200_000; // per-file limit — no whole-repo reads
const CONCURRENCY = 4;

export interface RepoRef {
  owner: string;
  repo: string;
  branch?: string;
}

export interface RepoMetadata {
  fullName: string;
  defaultBranch: string;
  description: string | null;
  pushedAt: string | null;
  stars: number;
  private: boolean;
}

export interface RepoFile {
  path: string;
  size: number;
  content: string | null; // null when too large / binary / fetch skipped
  encoding?: string;
  truncated?: boolean;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

function headers(token?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'LiaraPilot/0.1 (repo analyzer)',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function fetchRepoMetadata(ref: RepoRef, token?: string | null, signal?: AbortSignal): Promise<RepoMetadata> {
  const res = await fetch(`${API}/repos/${ref.owner}/${ref.repo}`, {
    headers: headers(token),
    signal,
    // bounded so analysis never hangs the workflow
  });
  if (res.status === 404) throw new GitHubError('مخزن پیدا نشد (یا خصوصی است و توکنی وصل نشده) — حساب GitHub خود را در «تنظیمات» وصل کنید', 404);
  if (res.status === 403) throw new GitHubError('محدودیت نرخ GitHub (۶۰ درخواست/ساعت بدون ورود) — حساب GitHub خود را در «تنظیمات ← گیت‌هاب» وصل کنید تا به ۵۰۰۰ درخواست/ساعت برسید', 403);
  if (!res.ok) throw new GitHubError(`خطای GitHub API (${res.status})`, res.status);
  const j = (await res.json()) as Record<string, unknown>;
  return {
    fullName: String(j.full_name ?? `${ref.owner}/${ref.repo}`),
    defaultBranch: String(j.default_branch ?? 'main'),
    description: (j.description as string) ?? null,
    pushedAt: (j.pushed_at as string) ?? null,
    stars: Number(j.stargazers_count ?? 0),
    private: Boolean(j.private),
  };
}

export async function fetchLatestCommit(ref: RepoRef, token?: string | null, signal?: AbortSignal): Promise<{ sha: string; message: string; date: string | null } | null> {
  const branch = ref.branch ? `?sha=${encodeURIComponent(ref.branch)}` : '';
  const res = await fetch(`${API}/repos/${ref.owner}/${ref.repo}/commits${branch}&per_page=1`, {
    headers: headers(token),
    signal,
  });
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<Record<string, unknown>>;
  const first = arr?.[0];
  if (!first) return null;
  return {
    sha: String(first.sha),
    message: String((first.commit as Record<string, unknown>)?.message ?? ''),
    date: ((first.commit as Record<string, unknown>)?.author as Record<string, unknown>)?.date as string | null,
  };
}

/** List root tree (recursive=false) — cheap classification of project layout. */
export async function fetchRootListing(ref: RepoRef, token?: string | null, branch?: string, signal?: AbortSignal): Promise<string[]> {
  const b = branch ?? ref.branch ?? 'HEAD';
  const res = await fetch(`${API}/repos/${ref.owner}/${ref.repo}/contents?ref=${encodeURIComponent(b)}`, {
    headers: headers(token),
    signal,
  });
  if (!res.ok) return [];
  const arr = (await res.json()) as Array<{ name: string; type: string }>;
  return arr.map((e) => e.name);
}

/** Single-file raw fetch with size guard. */
export async function fetchFile(ref: RepoRef, path: string, token?: string | null, branch?: string, signal?: AbortSignal): Promise<RepoFile | null> {
  const b = branch ?? ref.branch ?? 'HEAD';
  const res = await fetch(`${API}/repos/${ref.owner}/${ref.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(b)}`, {
    headers: headers(token),
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const j = (await res.json()) as { content?: string; encoding?: string; size?: number };
  const size = Number(j.size ?? 0);
  if (size > MAX_FILE_BYTES) {
    return { path, size, content: null, truncated: true };
  }
  if (j.encoding === 'base64' && j.content) {
    const buf = Buffer.from(j.content, 'base64');
    // crude binary sniff
    if (buf.includes(0)) return { path, size, content: null };
    return { path, size, content: buf.toString('utf8') };
  }
  return { path, size, content: null };
}

/** Bounded-concurrency batch file fetch. */
export async function fetchFiles(
  ref: RepoRef,
  paths: string[],
  token?: string | null,
  branch?: string,
  signal?: AbortSignal,
): Promise<RepoFile[]> {
  const results: RepoFile[] = [];
  const queue = [...paths];
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      if (!p) break;
      const f = await fetchFile(ref, p, token, branch, signal);
      if (f) results.push(f);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  return results;
}
