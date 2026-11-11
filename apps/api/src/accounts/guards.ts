import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { CSRF_COOKIE, SESSION_COOKIE } from '@smsvio/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { ApiError } from '../http/api-error.js';
import { applySessionCookies, clearAuthCookies, cookieSecure } from '../security/cookies.js';
import { SessionService } from './session.service.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const resolved = await this.sessions.resolve(request);
    if (resolved === null) {
      throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
    }
    request.auth = resolved.state;
    refreshCookie(
      request,
      reply,
      this.env.PUBLIC_ORIGIN,
      resolved.extendCookie,
      resolved.state.organizationId,
    );
    return true;
  }
}

@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const hadCookie = request.cookies[SESSION_COOKIE] !== undefined;
    const resolved = await this.sessions.resolve(request);
    if (resolved === null) {
      if (hadCookie) {
        clearAuthCookies(reply, cookieSecure(this.env.PUBLIC_ORIGIN));
      }
      return true;
    }
    request.auth = resolved.state;
    refreshCookie(
      request,
      reply,
      this.env.PUBLIC_ORIGIN,
      resolved.extendCookie,
      resolved.state.organizationId,
    );
    return true;
  }
}

function refreshCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  publicOrigin: string,
  extend: boolean,
  organizationId: string | null,
): void {
  if (!extend) {
    return;
  }
  const session = request.cookies[SESSION_COOKIE];
  const csrf = request.cookies[CSRF_COOKIE];
  if (session === undefined || csrf === undefined) {
    return;
  }
  applySessionCookies(reply, cookieSecure(publicOrigin), session, csrf, organizationId);
}
