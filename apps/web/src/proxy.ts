import { safeNextPath } from '@smsvio/shared';
import { type NextRequest, NextResponse } from 'next/server';

import { buildCsp, createNonce } from '@/lib/csp';

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    isHttps:
      request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:',
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const session = request.cookies.get('smsvio_session')?.value;
  const path = request.nextUrl.pathname;
  const redirect = authRedirect(request, path, session);
  const response = redirect ?? NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  if (redirect !== null) {
    response.headers.set('x-nonce', nonce);
  }
  return response;
}

function authRedirect(
  request: NextRequest,
  path: string,
  session: string | undefined,
): NextResponse | null {
  const needsSession = path.startsWith('/dashboard') || path.startsWith('/admin');
  if (needsSession && session === undefined) {
    const url = request.nextUrl.clone();
    url.pathname = '/signin';
    url.search = '';
    const next = safeNextPath(`${path}${request.nextUrl.search}`);
    if (next !== null) {
      url.searchParams.set('next', next);
    }
    return NextResponse.redirect(url);
  }
  if ((path === '/signin' || path === '/signup') && session !== undefined) {
    const next = safeNextPath(request.nextUrl.searchParams.get('next')) ?? '/dashboard';
    return NextResponse.redirect(new URL(next, request.url));
  }
  return null;
}

export const config = {
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|healthz|readyz).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
