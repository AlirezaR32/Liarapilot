// Provider router: dispatches repository reads to the right git host using
// the USER's own connected token (PAT or OAuth) when available — resolved at
// the last possible moment, inside the integration layer (credentials.md).

import { fetchLatestCommit as ghCommit, fetchFile as ghFile, fetchFiles as ghFiles, fetchRepoMetadata as ghMeta, fetchRootListing as ghRoot } from '@/lib/integrations/github/client';
import { fetchLatestCommit as glCommit, fetchFile as glFile, fetchFiles as glFiles, fetchRepoMetadata as glMeta, fetchRootListing as glRoot } from '@/lib/integrations/gitlab/client';
import { gitConnectionToken } from '@/lib/security/credentials';

export type RepoProvider = 'github' | 'gitlab';

export interface RepoSource {
  meta(ref: { owner: string; repo: string }, signal?: AbortSignal): Promise<{ fullName: string; defaultBranch: string }>;
  latestCommit(ref: { owner: string; repo: string }, branch?: string, signal?: AbortSignal): Promise<{ sha: string; message: string; date: string | null } | null>;
  rootListing(ref: { owner: string; repo: string }, branch?: string, signal?: AbortSignal): Promise<string[]>;
  files(ref: { owner: string; repo: string }, paths: string[], branch?: string, signal?: AbortSignal): Promise<Array<{ path: string; size: number; content: string | null; truncated?: boolean }>>;
  provider: RepoProvider;
  hasCredentials: boolean;
}

export async function getRepoSource(provider: RepoProvider, userId: string): Promise<RepoSource> {
  const { token, instanceUrl } = await gitConnectionToken(userId, provider);

  if (provider === 'gitlab') {
    const base = instanceUrl ?? 'https://gitlab.com';
    return {
      provider,
      hasCredentials: Boolean(token),
      async meta(ref, signal) {
        const m = await glMeta(ref, base, token, signal);
        return { fullName: m.fullName, defaultBranch: m.defaultBranch };
      },
      async latestCommit(ref, branch, signal) {
        return glCommit(ref, base, token, branch, signal);
      },
      async rootListing(ref, branch, signal) {
        return glRoot(ref, base, token, branch, signal);
      },
      async files(ref, paths, branch, signal) {
        return glFiles(ref, paths, base, token, branch, signal);
      },
    };
  }

  return {
    provider,
    hasCredentials: Boolean(token),
    async meta(ref, signal) {
      const m = await ghMeta(ref, token, signal);
      return { fullName: m.fullName, defaultBranch: m.defaultBranch };
    },
    async latestCommit(ref, branch, signal) {
      return ghCommit({ ...ref, branch }, token, signal);
    },
    async rootListing(ref, branch, signal) {
      return ghRoot(ref, token, branch, signal);
    },
    async files(ref, paths, branch, signal) {
      return ghFiles(ref, paths, token, branch, signal);
    },
  };
}

export function isRepoProvider(v: unknown): v is RepoProvider {
  return v === 'github' || v === 'gitlab';
}
