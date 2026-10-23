// API helpers: consistent errors, tenant resolution, JSON parsing.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  AuthError,
  getOrCreateWorkspaceUserByKey,
  requireProject,
  WORKSPACE_COOKIE,
} from '@/lib/security/session';

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data as Record<string, unknown>, typeof init === 'number' ? { status: init } : init);
}

export function apiError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function mapError(e: unknown) {
  if (e instanceof AuthError) return apiError(401, e.message);
  if (e instanceof Error) return apiError(500, e.message.slice(0, 300));
  return apiError(500, 'internal error');
}

/**
 * Resolve the acting user WITHOUT any site login (product decision): every
 * browser is its own private workspace. The "lp_ws" httpOnly cookie is set
 * by middleware; the matching user row is provisioned lazily on first use.
 * Connections (GitHub/GitLab/Liara/AI tokens) attach to this user —
 * each visitor connects THEIR OWN services; nothing comes from env.
 */
export async function resolveUser(): Promise<{ id: string; email: string; name: string | null }> {
  const jar = await cookies();
  const key = jar.get(WORKSPACE_COOKIE)?.value;
  if (!key || key.length < 24) {
    throw new AuthError('workspace cookie missing — reload the page to initialize your workspace');
  }
  const owner = await getOrCreateWorkspaceUserByKey(key);
  return { id: owner.id, email: owner.email, name: owner.name };
}

export { requireProject };

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AuthError('invalid JSON body');
  }
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
