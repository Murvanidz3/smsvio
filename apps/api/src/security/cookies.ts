import {
  CSRF_COOKIE,
  ORGANIZATION_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@smsvio/shared';
import type { FastifyReply } from 'fastify';

interface CookieBase {
  readonly path: '/';
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly maxAge: number;
}

export function cookieSecure(publicOrigin: string): boolean {
  return new URL(publicOrigin).protocol === 'https:';
}

export function applySessionCookies(
  reply: FastifyReply,
  secure: boolean,
  sessionToken: string,
  csrfToken: string,
  organizationId: string | null,
): void {
  const base = cookieBase(secure);
  reply.setCookie(SESSION_COOKIE, sessionToken, { ...base, httpOnly: true });
  reply.setCookie(CSRF_COOKIE, csrfToken, { ...base, httpOnly: false });
  if (organizationId === null) {
    reply.clearCookie(ORGANIZATION_COOKIE, { path: '/', sameSite: 'lax', secure, httpOnly: true });
  } else {
    reply.setCookie(ORGANIZATION_COOKIE, organizationId, { ...base, httpOnly: true });
  }
}

export function applyOrganizationCookie(
  reply: FastifyReply,
  secure: boolean,
  organizationId: string | null,
): void {
  if (organizationId === null) {
    reply.clearCookie(ORGANIZATION_COOKIE, { path: '/', sameSite: 'lax', secure, httpOnly: true });
    return;
  }
  reply.setCookie(ORGANIZATION_COOKIE, organizationId, { ...cookieBase(secure), httpOnly: true });
}

export function clearAuthCookies(reply: FastifyReply, secure: boolean): void {
  const options = { path: '/' as const, sameSite: 'lax' as const, secure, httpOnly: true };
  reply.clearCookie(SESSION_COOKIE, options);
  reply.clearCookie(CSRF_COOKIE, { ...options, httpOnly: false });
  reply.clearCookie(ORGANIZATION_COOKIE, options);
}

function cookieBase(secure: boolean): CookieBase {
  return { path: '/', sameSite: 'lax', secure, maxAge: SESSION_TTL_SECONDS };
}
