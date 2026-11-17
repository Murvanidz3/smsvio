import { type ArgumentsHost, Catch, type ExceptionFilter, Inject } from '@nestjs/common';
import { API_KEY_RATE_LIMIT, problemDetails } from '@smsvio/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { clearAuthCookies, cookieSecure } from '../security/cookies.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError(400, 'validation_error', 'Check the highlighted fields.', fields);
}

@Catch(ApiError)
export class ApiErrorFilter implements ExceptionFilter {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  catch(error: ApiError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const path = request.url.split('?')[0] ?? request.url;
    const publicApi = path.startsWith('/api/v1');
    if (error.code === 'unauthenticated' && !publicApi) {
      clearAuthCookies(reply, cookieSecure(this.env.PUBLIC_ORIGIN));
    }
    if (error.retryAfterSeconds !== undefined) {
      void reply.header('retry-after', String(error.retryAfterSeconds));
      void reply.header('cache-control', 'no-store');
    }
    if (publicApi) {
      if (error.code === 'rate_limited') {
        void reply.header('ratelimit-limit', String(API_KEY_RATE_LIMIT));
        void reply.header('ratelimit-remaining', '0');
        void reply.header('ratelimit-reset', String(error.retryAfterSeconds ?? 1));
      }
      void reply
        .type('application/problem+json')
        .status(error.status)
        .send(
          problemDetails({
            status: error.status,
            code: error.code,
            detail: error.message,
            instance: path,
            ...(error.fields === undefined ? {} : { errors: error.fields }),
          }),
        );
      return;
    }
    void reply.status(error.status).send({
      code: error.code,
      message: error.message,
      ...(error.fields === undefined ? {} : { fields: error.fields }),
    });
  }
}
