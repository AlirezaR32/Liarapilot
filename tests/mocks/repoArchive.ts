// Test mock for the repo source downloader — no network, no filesystem.
// The real graph/services run; the archive download is a platform edge.

export async function prepareRepoSource(opts: {
  userId: string;
  provider: string;
  owner: string;
  repo: string;
  ref?: string | null;
  token?: string | null;
  instanceUrl?: string | null;
  onProgress?: (m: string) => Promise<void> | void;
}) {
  return { dir: `/tmp/lp-test-source/${opts.repo}-${(opts.ref ?? 'head').slice(0, 7)}`, bytes: 1024 };
}

export function expectedSourceRoot(_userId: string, repo: string, ref: string | null): string {
  return `/tmp/lp-test-source/${repo}-${(ref ?? 'head').slice(0, 7)}`;
}

export class RepoArchiveError extends Error {}
