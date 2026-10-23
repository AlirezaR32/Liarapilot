// Liara API client — implements ONLY verified endpoints from the capability
// registry. Any operation not in the registry raises UnsupportedCapability
// (spec §3: never invent endpoints).

import { LIARA_API_BASE, capability } from './capabilities';

export class UnsupportedCapabilityError extends Error {
  constructor(public readonly capabilityId: string, reason: string) {
    super(reason);
  }
}

export class LiaraApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface LiaraApp {
  id: string;
  name: string;
  type?: string;
  status?: string;
  scale?: number;
  planId?: string;
  isDeployed?: boolean;
  createdAt?: string;
}

export interface LiaraRelease {
  id?: string;
  state?: string;
  platform?: string;
  port?: number;
  tag?: string;
  createdAt?: string;
  gitInfo?: { commit?: string | null; branch?: string | null; message?: string | null };
}

export const NOT_CONNECTED_MESSAGE =
  'اتصال لیارا برقرار نیست — توکن API لیارا را از کنسول لیارا بگیرید و در «تنظیمات ← اتصال لیارا» وارد کنید.';

/** One-off authenticated call with an explicit token (validated live on connect). */
export async function callLiaraMe(token: string): Promise<{ email: string | null; fullname: string | null } | null> {
  for (const p of ['/v1/me', '/me']) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(`${LIARA_API_BASE}${p}`, {
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      clearTimeout(timer);
      if (res.status === 401 || res.status === 403) throw new LiaraApiError('token rejected by Liara (invalid or expired)', 401);
      if (!res.ok) continue;
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const user = (j.user as Record<string, unknown> | undefined) ?? j;
      return {
        email: user.email ? String(user.email) : null,
        fullname: user.fullname ? String(user.fullname) : null,
      };
    } catch (e) {
      if (e instanceof LiaraApiError) throw e;
      // network failure — try next path, else surface
      continue;
    }
  }
  return null;
}

async function call(path: string, token: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<unknown> {
  if (!token) throw new LiaraApiError(NOT_CONNECTED_MESSAGE, 401);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${LIARA_API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body as Record<string, unknown>)?.message || (body as Record<string, unknown>)?.error || res.statusText;
      throw new LiaraApiError(`Liara API ${res.status}: ${String(msg)}`, res.status);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** GET /v1/projects — verified. */
export async function listApps(token: string): Promise<LiaraApp[]> {
  const cap = capability('apps.list');
  if (cap?.verification !== 'verified') throw new UnsupportedCapabilityError('apps.list', 'not verified');
  const j = (await call('/v1/projects', token)) as { projects?: Array<Record<string, unknown>> };
  return (j.projects ?? []).map((p) => ({
    id: String(p._id ?? p.project_id ?? ''),
    name: String(p.project_id ?? p._id ?? ''),
    type: p.type ? String(p.type) : undefined,
    status: p.status ? String(p.status) : undefined,
    scale: typeof p.scale === 'number' ? p.scale : undefined,
    planId: p.planID ? String(p.planID) : undefined,
    isDeployed: typeof p.isDeployed === 'boolean' ? p.isDeployed : undefined,
    createdAt: p.created_at ? String(p.created_at) : undefined,
  }));
}

/** GET /v1/projects/{name}/logs?since=... — verified. Bounded retrieval. */
export async function getAppLogs(
  appName: string,
  sinceIso: string,
  token: string,
  maxLines = 200,
): Promise<Array<{ type: string; datetime: string; message: string }>> {
  const cap = capability('apps.logs');
  if (cap?.verification !== 'verified') throw new UnsupportedCapabilityError('apps.logs', 'not verified');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(appName)) throw new LiaraApiError('invalid app name', 400);
  const j = (await call(`/v1/projects/${encodeURIComponent(appName)}/logs?since=${encodeURIComponent(sinceIso)}`, token)) as Array<{
    type: string;
    datetime: string;
    message: string;
  }>;
  return (Array.isArray(j) ? j : []).slice(0, maxLines);
}

/** POST /v1/projects/{name}/actions/restart — verified. */
export async function restartApp(appName: string, token: string): Promise<void> {
  const cap = capability('apps.restart');
  if (cap?.verification !== 'verified') throw new UnsupportedCapabilityError('apps.restart', 'not verified');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(appName)) throw new LiaraApiError('invalid app name', 400);
  await call(`/v1/projects/${encodeURIComponent(appName)}/actions/restart`, token, { method: 'POST', body: '{}' });
}

/** POST /v1/projects/{name}/actions/scale {scale:1|0} — verified. */
export async function scaleApp(appName: string, on: boolean, token: string): Promise<void> {
  const cap = capability('apps.scale_on_off');
  if (cap?.verification !== 'verified') throw new UnsupportedCapabilityError('apps.scale_on_off', 'not verified');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(appName)) throw new LiaraApiError('invalid app name', 400);
  await call(`/v1/projects/${encodeURIComponent(appName)}/actions/scale`, token, {
    method: 'POST',
    body: JSON.stringify({ scale: on ? 1 : 0 }),
  });
}

/** POST /v1/projects — verified (create app). Used behind the deploy approval gate. */
export async function createApp(name: string, planID: string, platform: string, token: string): Promise<void> {
  const cap = capability('apps.create');
  if (cap?.verification !== 'verified') throw new UnsupportedCapabilityError('apps.create', 'not verified');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) throw new LiaraApiError('invalid app name', 400);
  await call('/v1/projects', token, {
    method: 'POST',
    body: JSON.stringify({ name, planID, platform }),
  });
}

/** GET /v1/projects/{name}/releases — verified. */
export async function listReleases(appName: string, token: string): Promise<{ currentRelease?: string; releases: LiaraRelease[] }> {
  const cap = capability('apps.releases');
  if (cap?.verification !== 'verified') throw new UnsupportedCapabilityError('apps.releases', 'not verified');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(appName)) throw new LiaraApiError('invalid app name', 400);
  const j = (await call(`/v1/projects/${encodeURIComponent(appName)}/releases`, token)) as Record<string, unknown>;
  return {
    currentRelease: j.currentRelease ? String(j.currentRelease) : undefined,
    releases: Array.isArray(j.releases) ? (j.releases as LiaraRelease[]).slice(0, 20) : [],
  };
}

// NOTE: There is intentionally NO deploySources() here. The verified deploy
// endpoint (POST /v2/projects/{name}/sources) requires a PREPARED .gz archive;
// the spec (§8) directs us to prefer the CLI workflow for directory deploys.
// A future milestone can add archive preparation + upload behind an approval.
