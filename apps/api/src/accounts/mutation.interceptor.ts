import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';

import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { assertCsrf, assertOrigin, hasSessionCookie, requestPath } from '../http/client.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class MutationInterceptor implements NestInterceptor {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return next.handle();
    }
    if (!requestPath(request).startsWith('/api/internal')) {
      return next.handle();
    }
    assertOrigin(request, this.env.PUBLIC_ORIGIN);
    if (hasSessionCookie(request)) {
      assertCsrf(request);
    }
    return next.handle();
  }
}
