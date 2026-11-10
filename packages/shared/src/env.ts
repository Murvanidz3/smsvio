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
