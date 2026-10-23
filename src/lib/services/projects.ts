// Project service: connect repos, cache profiles by revision (spec §6).
import { db } from '@/lib/db';
import { analyzeRepository } from '@/lib/agent/repositoryAnalysis';
import { isRepoProvider } from '@/lib/integrations/repoSource';
import type { ProjectProfile } from '@/lib/types';

export async function getProfileCached(
  project: { id: string; userId: string; repoOwner: string; repoName: string; repoProvider?: string; lastProfileSha: string | null; repoBranch: string },
  opts: { force?: boolean },
): Promise<{ profile: ProjectProfile; fromCache: boolean }> {
  if (!opts.force && project.lastProfileSha) {
    const snap = await db.analysisSnapshot.findUnique({
      where: { projectId_commitSha: { projectId: project.id, commitSha: project.lastProfileSha } },
    });
    if (snap) {
      return { profile: JSON.parse(snap.profileJson) as ProjectProfile, fromCache: true };
    }
  }
  const profile = await analyzeRepository(
    { owner: project.repoOwner, repo: project.repoName },
    {
      branch: project.repoBranch,
      provider: isRepoProvider(project.repoProvider) ? project.repoProvider : 'github',
      userId: project.userId,
    },
  );
  await db.analysisSnapshot.upsert({
    where: { projectId_commitSha: { projectId: project.id, commitSha: profile.analyzedSha ?? 'unknown' } },
    create: { projectId: project.id, commitSha: profile.analyzedSha ?? 'unknown', profileJson: JSON.stringify(profile) },
    update: { profileJson: JSON.stringify(profile) },
  });
  await db.project.update({
    where: { id: project.id },
    data: { lastProfileSha: profile.analyzedSha ?? null },
  });
  return { profile, fromCache: false };
}

export async function connectRepo(
  userId: string,
  input: { owner: string; name: string; branch?: string; label?: string; provider?: string },
) {
  const provider = isRepoProvider(input.provider) ? input.provider : 'github';
  const project = await db.project.upsert({
    where: { userId_repoOwner_repoName: { userId, repoOwner: input.owner, repoName: input.name } },
    create: {
      userId,
      name: input.label ?? `${input.owner}/${input.name}`,
      repoProvider: provider,
      repoOwner: input.owner,
      repoName: input.name,
      repoBranch: input.branch ?? 'main',
    },
    update: { archived: false, repoProvider: provider },
  });
  return project;
}

export function projectNameForLiara(owner: string, name: string): string {
  // Liara app ids: lowercase alnum + dashes (validated in command templates too)
  const base = `${owner}-${name}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return base || 'liarapilot-app';
}
