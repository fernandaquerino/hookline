import { type NextRequest, NextResponse } from 'next/server';

/**
 * Sends visitors without a session cookie to the login page. This only checks that the cookie
 * exists; the API verifies it on every call.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.has('hookline_session')) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!login|api|_next|favicon.ico).*)'],
};
