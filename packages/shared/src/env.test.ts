import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  EnvValidationError,
  httpUrlSchema,
  logLevelSchema,
  nodeEnvSchema,
  optionalEnv,
  parseEnv,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
} from './env.js';

const schema = z.object({
  NODE_ENV: nodeEnvSchema,
  PORT: portSchema,
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema,
  LOG_LEVEL: logLevelSchema,
  SENTRY_DSN: optionalEnv(httpUrlSchema),
});

const valid = {
  NODE_ENV: 'production',
  PORT: '4000',
  DATABASE_URL: 'postgresql://user:pass@postgres:5432/smsvio',
  REDIS_URL: 'redis://:secret@redis:6379',
};

describe('parseEnv', () => {
  it('returns typed values and applies defaults', () => {
    const env = parseEnv(schema, valid);
    expect(env).toEqual({
      NODE_ENV: 'production',
      PORT: 4000,
      DATABASE_URL: valid.DATABASE_URL,
      REDIS_URL: valid.REDIS_URL,
      LOG_LEVEL: 'info',
      SENTRY_DSN: undefined,
    });
  });

  it('defaults NODE_ENV to development', () => {
    const { NODE_ENV: _omitted, ...rest } = valid;
    expect(parseEnv(schema, rest).NODE_ENV).toBe('development');
  });

  it('treats an empty optional variable as unset', () => {
    expect(parseEnv(schema, { ...valid, SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
  });

  it('accepts a set optional variable', () => {
    const dsn = 'https://key@o1.ingest.sentry.io/1';
    expect(parseEnv(schema, { ...valid, SENTRY_DSN: dsn }).SENTRY_DSN).toBe(dsn);
  });

  it('lists every invalid variable by name without echoing values', () => {
    const secret = 'mysql://root:hunter2@db/app';
    let caught: unknown;
    try {
      parseEnv(schema, { ...valid, PORT: '70000', DATABASE_URL: secret, REDIS_URL: undefined });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const error = caught as EnvValidationError;
    expect(error.name).toBe('EnvValidationError');
    expect(error.issues.map((issue) => issue.split(':')[0])).toEqual([
      'PORT',
      'DATABASE_URL',
      'REDIS_URL',
    ]);
    expect(error.message).toMatch(/^Invalid environment configuration:\n {2}- PORT: /);
    expect(error.message).not.toContain('hunter2');
  });

  it('reports root-level problems', () => {
    expect(() => parseEnv(z.string(), {})).toThrow(/\(root\): /);
  });
});

describe('url schemas', () => {
  it.each([
    [postgresUrlSchema, 'postgres://u:p@h:5432/db', true],
    [postgresUrlSchema, 'postgresql://u:p@h/db', true],
    [postgresUrlSchema, 'mysql://u:p@h/db', false],
    [redisUrlSchema, 'redis://h:6379', true],
    [redisUrlSchema, 'rediss://h:6380', true],
    [redisUrlSchema, 'http://h', false],
    [httpUrlSchema, 'https://smsvio.com', true],
    [httpUrlSchema, 'http://localhost:8080', true],
    [httpUrlSchema, 'ftp://smsvio.com', false],
  ] as const)('validates %#', (schemaUnderTest, value, ok) => {
    expect(schemaUnderTest.safeParse(value).success).toBe(ok);
  });

  it('rejects ports outside 1-65535 and non-integers', () => {
    expect(portSchema.safeParse('0').success).toBe(false);
    expect(portSchema.safeParse('65536').success).toBe(false);
    expect(portSchema.safeParse('80.5').success).toBe(false);
    expect(portSchema.parse('443')).toBe(443);
  });
});
