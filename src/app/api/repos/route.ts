// GET /api/repos?provider=github|gitlab
// Lists the signed-in workspace's OWN repositories from the connected GitHub
// or GitLab account — using the user's OWN encrypted token (PAT or browser
// Device-Flow OAuth). Read-only, bounded to the first 100 repos sorted by
// latest activity. Never touches env credentials.
import { resolveUser, json, mapError } from '@/lib/api';
import { gitConnectionToken } from '@/lib/security/credentials';
import { isRepoProvider } from '@/lib/integrations/repoSource';

export const dynamic = 'force-dynamic';

export interface RepoListEntry {
  provider: 'github' | 'gitlab';
  fullName: string; // owner/repo
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  stars: number;
  url: string;
  fork: boolean;
}

function ghHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'LiaraPilot/0.1 (repo browser)',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function GET(req: Request) {
  try {
    const user = await resolveUser();
    const url = new URL(req.url);
    const providerParam = url.searchParams.get('provider');
    if (!isRepoProvider(providerParam)) {
      return json({ error: 'provider must be github or gitlab' }, 400);
    }
    const provider = providerParam;
    const { token, instanceUrl } = await gitConnectionToken(user.id, provider);

    if (!token) {
      return json({
        provider,
        connected: false,
        repos: [],
        hint:
          provider === 'github'
            ? 'برای دیدن مخزن‌های GitHub خودتان، ابتدا در «تنظیمات ← گیت‌هاب» با مرورگر وارد شوید یا توکن شخصی (PAT) بدهید.'
            : 'برای دیدن پروژه‌های GitLab خودتان، ابتدا در «تنظیمات ← گیت‌لب» وارد شوید یا توکن شخصی بدهید.',
      });
    }

    const repos: RepoListEntry[] = [];
    if (provider === 'github') {
      const res = await fetch(
        'https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=100&affiliation=owner,collaborator,organization_member',
        { headers: ghHeaders(token) },
      );
      if (res.status === 401) {
        return json({ provider, connected: false, repos: [], hint: 'توکن GitHub معتبر نیست یا منقضی شده — دوباره در «تنظیمات» وصل شوید.' });
      }
      if (res.status === 403) {
        return json({ error: 'محدودیت نرخ GitHub API — کمی بعد دوباره تلاش کنید', code: 'rate_limited' }, 429);
      }
      if (!res.ok) return json({ error: `خطای GitHub API (${res.status})` }, 502);
      const items = (await res.json()) as Array<Record<string, unknown>>;
      for (const r of items) {
        const fullName = String(r.full_name ?? '');
        const [owner, name] = fullName.split('/');
        if (!owner || !name) continue;
        repos.push({
          provider: 'github',
          fullName,
          owner,
          name,
          description: (r.description as string) ?? null,
          language: (r.language as string) ?? null,
          defaultBranch: String(r.default_branch ?? 'main'),
          private: Boolean(r.private),
          pushedAt: (r.pushed_at as string) ?? null,
          stars: Number(r.stargazers_count ?? 0),
          url: String(r.html_url ?? `https://github.com/${fullName}`),
          fork: Boolean(r.fork),
        });
      }
    } else {
      const base = (instanceUrl ?? 'https://gitlab.com').replace(/\/+$/, '');
      const res = await fetch(
        `${base}/api/v4/projects?membership=true&order_by=last_activity_at&sort=desc&per_page=100`,
        { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'LiaraPilot/0.1 (repo browser)' } },
      );
      if (res.status === 401 || res.status === 403) {
        return json({ provider, connected: false, repos: [], hint: 'توکن GitLab معتبر نیست یا scope کافی ندارد (read_api لازم است) — دوباره در «تنظیمات» وصل شوید.' });
      }
      if (!res.ok) return json({ error: `خطای GitLab API (${res.status})` }, 502);
      const items = (await res.json()) as Array<Record<string, unknown>>;
      for (const r of items) {
        const fullName = String(r.path_with_namespace ?? '');
        const parts = fullName.split('/');
        if (parts.length < 2) continue;
        const owner = parts[0];
        const name = parts[parts.length - 1];
        repos.push({
          provider: 'gitlab',
          fullName,
          owner,
          name,
          description: (r.description as string) ?? null,
          language: null,
          defaultBranch: String(r.default_branch ?? 'main'),
          private: r.visibility ? String(r.visibility) !== 'public' : true,
          pushedAt: (r.last_activity_at as string) ?? null,
          stars: Number(r.star_count ?? 0),
          url: String(r.web_url ?? r.http_url_to_repo ?? ''),
          fork: false,
        });
      }
    }

    return json({ provider, connected: true, repos });
  } catch (e) {
    return mapError(e);
  }
}
