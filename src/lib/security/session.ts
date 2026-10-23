// Workspace identity — commercial product with NO site login (product decision).
// Every browser gets its own private workspace: middleware sets the "lp_ws"
// httpOnly cookie; the first API call lazily provisions the matching user row.
// All data (projects, connections, chat, approvals) is tenant-scoped per user,
// so each visitor works in isolation with THEIR OWN connected services.
//
// The authorization helpers below are the seam where real multi-tenant auth
// plugs in (see docs/security.md). Every API route MUST resolve the acting
// user via resolveUser() and scope project queries by userId.

import { cookies } from 'next/headers';
import { db } from '@/lib/db';

export const SESSION_COOKIE = 'lp_session'; // legacy session (kept for compatibility)
export const WORKSPACE_COOKIE = 'lp_ws';
const WORKSPACE_TTL_DAYS = 365;

export const WORKSPACE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: WORKSPACE_TTL_DAYS * 24 * 3600,
};

/** Find or provision the workspace user bound to a browser workspace key. */
export async function getOrCreateWorkspaceUserByKey(workspaceKey: string) {
  const existing = await db.user.findUnique({ where: { workspaceKey } });
  if (existing) return existing;
  const suffix = workspaceKey.replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase() || 'anon';
  return db.user.create({
    data: {
      email: `ws-${suffix}@workspace.liarapilot.local`,
      workspaceKey,
    },
  });
}

/** Thrown when authorization fails; route handlers map this to 401/403. */
export class AuthError extends Error {}

export async function requireUser() {
  const { resolveUser } = await import('@/lib/api');
  return resolveUser();
}

/** Tenant-scoped project fetch — THE gate against cross-tenant ID manipulation. */
export async function requireProject(projectId: string, userId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, userId, archived: false },
  });
  if (!project) throw new AuthError('project not found or access denied');
  return project;
}
