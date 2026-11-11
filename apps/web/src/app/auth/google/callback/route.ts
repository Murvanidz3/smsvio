import { type NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

/** Forwards Google's browser redirect to the API when Caddy is not in front (pnpm dev, Playwright). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const base =
    process.env.API_INTERNAL_URL ??
    (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:4000' : undefined);
  if (base === undefined) {
    return NextResponse.json({ code: 'not_found', message: 'Not found.' }, { status: 404 });
  }
  const target = new URL(`/auth/google/callback${request.nextUrl.search}`, base);
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) {
    headers.delete(name);
  }
  const response = await fetch(target, { method: 'GET', headers, redirect: 'manual' });
  const outbound = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie' && !HOP_BY_HOP.has(key.toLowerCase())) {
      outbound.set(key, value);
    }
  });
  for (const cookie of response.headers.getSetCookie()) {
    outbound.append('set-cookie', cookie);
  }
  return new NextResponse(response.body, { status: response.status, headers: outbound });
}
