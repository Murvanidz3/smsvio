import * as Sentry from '@sentry/nestjs';
import { httpUrlSchema, optionalEnv, parseEnv } from '@smsvio/shared';
import { z } from 'zod';

export interface SentryOptions {
  readonly dsn: string | undefined;
  readonly environment: string;
  readonly release: string | undefined;
  readonly service: string;
}

/**
 * Initialises Sentry error monitoring when a DSN is configured. Must run before the application
 * imports anything else (load it with `node --import`). Returns whether Sentry was enabled.
 */
export function initSentry({ dsn, environment, release, service }: SentryOptions): boolean {
  if (dsn === undefined) {
    return false;
  }
  Sentry.init({
    dsn,
    environment,
    ...(release === undefined ? {} : { release }),
    initialScope: { tags: { service } },
    // Message bodies, phone numbers and credentials must never leave our servers.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { allow: ['user-agent', 'content-type', 'x-request-id'] },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: false,
    },
  });
  return true;
}

const sentryEnvSchema = z.object({
  NODE_ENV: z.string().min(1).default('development'),
  SENTRY_DSN: optionalEnv(httpUrlSchema),
  SENTRY_ENVIRONMENT: optionalEnv(z.string().min(1)),
  APP_RELEASE: optionalEnv(z.string().min(1)),
});

/** Reads SENTRY_DSN, SENTRY_ENVIRONMENT (defaults to NODE_ENV) and APP_RELEASE, then initialises. */
export function initSentryFromEnv(
  service: string,
  source: Readonly<Record<string, string | undefined>>,
): boolean {
  const env = parseEnv(sentryEnvSchema, source);
  return initSentry({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.APP_RELEASE,
    service,
  });
}
