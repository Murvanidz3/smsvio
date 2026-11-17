import {
  httpUrlSchema,
  logLevelSchema,
  nodeEnvSchema,
  optionalEnv,
  parseEnv,
  postgresUrlSchema,
  redisUrlSchema,
} from '@smsvio/shared';
import { z } from 'zod';

export const workerEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  REDIS_URL: redisUrlSchema,
  DATABASE_URL: postgresUrlSchema,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(2),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  SENTRY_DSN: optionalEnv(httpUrlSchema),
  SENTRY_ENVIRONMENT: optionalEnv(z.string().min(1)),
  APP_RELEASE: optionalEnv(z.string().min(1)),
  /** Same 32-byte key the api uses. Webhook secrets are decrypted with it. */
  APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters'),
  PUBLIC_ORIGIN: optionalEnv(z.url()),
  EMAIL_MODE: z.enum(['disabled', 'smtp']).default('disabled'),
  SMTP_HOST: optionalEnv(z.string().min(1)),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: optionalEnv(z.string().min(1)),
  SMTP_PASSWORD: optionalEnv(z.string().min(1)),
  SMTP_FROM: optionalEnv(z.string().trim().min(3).max(200)),
  /** When set, simulated delivery receipts are posted to the provider hook on this origin. */
  API_INTERNAL_URL: optionalEnv(
    z.string().refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }),
  ),
});

export type WorkerEnv = z.output<typeof workerEnvSchema>;

export const WORKER_ENV = Symbol('WORKER_ENV');

export function loadWorkerEnv(source: Readonly<Record<string, string | undefined>>): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}
