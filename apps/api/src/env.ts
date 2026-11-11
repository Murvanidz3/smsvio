import {
  httpUrlSchema,
  logLevelSchema,
  nodeEnvSchema,
  optionalEnv,
  parseEnv,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
} from '@smsvio/shared';
import { z } from 'zod';

const originSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '';
}, 'must be an origin with no path, query, or userinfo');

export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: portSchema.default(4000),
    DATABASE_URL: postgresUrlSchema,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: redisUrlSchema,
    /** Number of reverse-proxy hops in front of the API (Caddy) whose X-Forwarded-For is trusted. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2000),
    SENTRY_DSN: optionalEnv(httpUrlSchema),
    SENTRY_ENVIRONMENT: optionalEnv(z.string().min(1)),
    APP_RELEASE: optionalEnv(z.string().min(1)),
    /** Browser origin allowed to call cookie-authenticated routes, for example https://smsvio.com. */
    PUBLIC_ORIGIN: originSchema,
    /** 32-byte AES-256-GCM key, hex encoded. Ciphertexts are prefixed with the key version. */
    APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters'),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: portSchema.default(587),
    SMTP_USER: optionalEnv(z.string().min(1)),
    SMTP_PASSWORD: optionalEnv(z.string().min(1)),
    SMTP_FROM: z.string().trim().min(3).max(200),
    /**
     * When set outside production, account email is written to this directory instead of SMTP.
     * Used by the end-to-end tests. Production refuses to start if it is set.
     */
    MAIL_SINK_DIR: optionalEnv(z.string().min(1)),
  })
  .superRefine((value, ctx) => {
    if ((value.SMTP_USER === undefined) !== (value.SMTP_PASSWORD === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'SMTP_USER and SMTP_PASSWORD must both be set, or both left empty',
      });
    }
    if (value.NODE_ENV === 'production' && value.MAIL_SINK_DIR !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_SINK_DIR'],
        message: 'must not be set in production',
      });
    }
  });

export type ApiEnv = z.output<typeof apiEnvSchema>;

export function loadApiEnv(source: Readonly<Record<string, string | undefined>>): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}
