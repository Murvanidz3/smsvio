import { z } from 'zod';

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validates environment variables against a zod schema and throws a readable error listing every
 * invalid variable. Values are never included in the message because they may be secrets.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Readonly<Record<string, string | undefined>>,
): z.output<T> {
  const result = schema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  throw new EnvValidationError(result.error.issues.map(formatIssue));
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
  return `${key}: ${issue.message}`;
}

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/** Treats an empty string (common in .env files and compose interpolation) as "not set". */
export function optionalEnv<T extends z.ZodType>(schema: T) {
  return z.preprocess(emptyToUndefined, schema.optional());
}

export const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export const logLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  .default('info');

export const portSchema = z.coerce.number().int().min(1).max(65535);

export const postgresUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });

export const redisUrlSchema = z.url({ protocol: /^rediss?$/ });

export const httpUrlSchema = z.url({ protocol: /^https?$/ });

/** Sent API origin. Requests are sent to `/v3` on this host. */
export const SENT_DM_DEFAULT_BASE_URL = 'https://api.sent.dm';

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === ''
    );
  } catch {
    return false;
  }
}

const httpsOriginSchema = z
  .string()
  .refine(isHttpsOrigin, 'must be an https origin with no path, query, or userinfo');

/**
 * Sent.dm account config. The API key is optional so the platform still boots without it.
 * An empty key means the Sent client is unconfigured. Never log the key.
 */
export const sentDmEnvFields = {
  SENT_DM_API_KEY: z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }, z.string().min(1).optional()),
  SENT_DM_BASE_URL: z.preprocess(
    (value) => (value === '' || value === undefined ? SENT_DM_DEFAULT_BASE_URL : value),
    httpsOriginSchema,
  ),
  /**
   * Signing secret of the Sent webhook (`whsec_...`), shown once in the Sent dashboard.
   * Empty means the Sent webhook endpoint answers 404 and nothing is processed.
   */
  SENT_DM_WEBHOOK_SECRET: z.preprocess(
    (value) => {
      if (typeof value !== 'string') {
        return value;
      }
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    },
    z
      .string()
      .regex(/^(whsec_)?[A-Za-z0-9+/]+={0,2}$/, 'must be a whsec_ base64 secret')
      .optional(),
  ),
  /** `true` adds "sandbox": true to every Sent send: validated by Sent, never delivered or charged. */
  SENT_DM_SANDBOX: z.preprocess(
    (value) => (value === '' || value === undefined ? 'false' : value),
    z.enum(['true', 'false']).transform((value) => value === 'true'),
  ),
};
