import type { FastifyRequest } from 'fastify';

import { CSRF_COOKIE, SESSION_COOKIE } from '@smsvio/shared';

import { ApiError } from './api-error.js';
import { tokensEqual } from '../security/tokens.js';

export interface ClientInfo {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export function clientInfo(request: FastifyRequest): ClientInfo {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip.length > 0 ? request.ip.slice(0, 64) : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}

export function assertOrigin(request: FastifyRequest, publicOrigin: string): void {
  const origin = request.headers.origin;
  if (origin !== publicOrigin) {
    throw new ApiError(403, 'origin_rejected', 'This action has to come from the SMSVIO site.');
  }
}

export function assertCsrf(request: FastifyRequest): void {
  const cookie = request.cookies[CSRF_COOKIE];
  const header = request.headers['x-csrf-token'];
  const presented = Array.isArray(header) ? header[0] : header;
  if (cookie === undefined || presented === undefined || !tokensEqual(cookie, presented)) {
    throw new ApiError(403, 'csrf_failed', 'Refresh the page and try again.');
  }
}

export function hasSessionCookie(request: FastifyRequest): boolean {
  return request.cookies[SESSION_COOKIE] !== undefined;
}

export function requestPath(request: FastifyRequest): string {
  const url = request.url;
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}
