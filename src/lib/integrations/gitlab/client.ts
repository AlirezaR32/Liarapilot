// GitLab REST integration — mirrors the bounded-read GitHub client surface.
// Works with gitlab.com and self-hosted instances (instanceUrl from the
// user's connection or GITLAB_URL env).
//   GET /api/v4/projects/:id                      → metadata
//   GET /api/v4/projects/:id/repository/commits   → latest commit
//   GET /api/v4/projects/:id/repository/tree      → root listing
//   GET /api/v4/projects/:id/repository/files/:path?ref= → file w/ base64 content

const MAX_FILE_BYTES = 200_000;

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
  content: string | null;
  truncated?: boolean;
}

export class GitLabError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

function apiBase(instanceUrl: string): string {
  return `${instanceUrl.replace(/\/+$/, '')}/api/v4`;
}

function headers(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': 'LiaraPilot/0.1 (repo analyzer)' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** GitLab URL-encodes project paths ("owner/repo" → "owner%2Frepo"). */
function projectId(ref: RepoRef): string {
  return encodeURIComponent(`${ref.owner}/${ref.repo}`);
}

export async function fetchRepoMetadata(
  ref: RepoRef,
  instanceUrl: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<RepoMetadata> {
  const res = await fetch(`${apiBase(instanceUrl)}/projects/${projectId(ref)}`, {
    headers: headers(token),
    signal,
  });
  if (res.status === 404) throw new GitLabError('project not found (or private without token)', 404);
  if (res.status === 403) throw new GitLabError('GitLab access forbidden — token needs read_api scope', 403);
  if (!res.ok) throw new GitLabError(`GitLab API error ${res.status}`, res.status);
  const j = (await res.json()) as Record<string, unknown>;
  return {
    fullName: String(j.path_with_namespace ?? `${ref.owner}/${ref.repo}`),
    defaultBranch: String(j.default_branch ?? 'main'),
    description: (j.description as string) ?? null,
    pushedAt: (j.last_activity_at as string) ?? null,
    stars: Number(j.star_count ?? 0),
    private: Boolean(j.visibility && j.visibility !== 'public'),
  };
}

export async function fetchLatestCommit(
  ref: RepoRef,
  instanceUrl: string,
  token: string | null,
  branch?: string,
  signal?: AbortSignal,
): Promise<{ sha: string; message: string; date: string | null } | null> {
  const b = branch ?? ref.branch ?? 'HEAD';
  const res = await fetch(
    `${apiBase(instanceUrl)}/projects/${projectId(ref)}/repository/commits?ref_name=${encodeURIComponent(b)}&per_page=1`,
    { headers: headers(token), signal },
  );
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<Record<string, unknown>>;
  const first = arr?.[0];
  if (!first) return null;
  return {
    sha: String(first.id),
    message: String(first.message ?? first.title ?? ''),
    date: (first.created_at as string) ?? null,
  };
}

export async function fetchRootListing(
  ref: RepoRef,
  instanceUrl: string,
  token: string | null,
  branch?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const b = branch ?? ref.branch ?? 'HEAD';
  const res = await fetch(
    `${apiBase(instanceUrl)}/projects/${projectId(ref)}/repository/tree?ref=${encodeURIComponent(b)}&per_page=100`,
    { headers: headers(token), signal },
  );
  if (!res.ok) return [];
  const arr = (await res.json()) as Array<{ name: string; type: string }>;
  return arr.map((e) => e.name);
}

export async function fetchFile(
  ref: RepoRef,
  path: string,
  instanceUrl: string,
  token: string | null,
  branch?: string,
  signal?: AbortSignal,
): Promise<RepoFile | null> {
  const b = branch ?? ref.branch ?? 'HEAD';
  const res = await fetch(
    `${apiBase(instanceUrl)}/projects/${projectId(ref)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(b)}`,
    { headers: headers(token), signal },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const j = (await res.json()) as { size?: number; content?: string; encoding?: string };
  const size = Number(j.size ?? 0);
  if (size > MAX_FILE_BYTES) return { path, size, content: null, truncated: true };
  if (j.encoding === 'base64' && j.content) {
    const buf = Buffer.from(j.content, 'base64');
    if (buf.includes(0)) return { path, size, content: null };
    return { path, size, content: buf.toString('utf8') };
  }
  return { path, size, content: null };
}

export async function fetchFiles(
  ref: RepoRef,
  paths: string[],
  instanceUrl: string,
  token: string | null,
  branch?: string,
  signal?: AbortSignal,
): Promise<RepoFile[]> {
  const results: RepoFile[] = [];
  const queue = [...paths];
  const CONCURRENCY = 4;
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      if (!p) break;
      const f = await fetchFile(ref, p, instanceUrl, token, branch, signal);
      if (f) results.push(f);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  return results;
}
