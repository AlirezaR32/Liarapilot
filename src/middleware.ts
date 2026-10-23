// Middleware: guarantees every visitor carries a private workspace cookie.
// The cookie holds ONLY a random opaque key — user rows are provisioned
// lazily by resolveUser() (no DB access from the edge middleware).
import { NextResponse, type NextRequest } from 'next/server';

const WORKSPACE_COOKIE = 'lp_ws';

export function middleware(req: NextRequest) {
  const existing = req.cookies.get(WORKSPACE_COOKIE)?.value;
  if (existing && existing.length >= 24) return NextResponse.next();

  const key = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const res = NextResponse.next();
  res.cookies.set(WORKSPACE_COOKIE, key, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 24 * 3600,
  });
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg|fonts/|api/health).*)'],
};
