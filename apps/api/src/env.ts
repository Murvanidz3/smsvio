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

export const apiEnvSchema = z.object({
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
});

export type ApiEnv = z.output<typeof apiEnvSchema>;

export function loadApiEnv(source: Readonly<Record<string, string | undefined>>): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}
