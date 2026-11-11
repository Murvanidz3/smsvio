import { type ArgumentsHost, Catch, type ExceptionFilter, Inject } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

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
    if (error.code === 'unauthenticated') {
      clearAuthCookies(reply, cookieSecure(this.env.PUBLIC_ORIGIN));
    }
    if (error.retryAfterSeconds !== undefined) {
      void reply.header('retry-after', String(error.retryAfterSeconds));
      void reply.header('cache-control', 'no-store');
    }
    void reply.status(error.status).send({
      code: error.code,
      message: error.message,
      ...(error.fields === undefined ? {} : { fields: error.fields }),
    });
  }
}
