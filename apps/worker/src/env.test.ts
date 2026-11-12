import { EnvValidationError } from '@smsvio/shared';
import { describe, expect, it } from 'vitest';

import { loadWorkerEnv } from './env.js';

describe('loadWorkerEnv', () => {
  it('applies defaults', () => {
    expect(
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
      }),
    ).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      REDIS_URL: 'redis://redis:6379',
      DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
      DATABASE_POOL_MAX: 2,
      WORKER_HEARTBEAT_INTERVAL_MS: 10_000,
      SENTRY_DSN: undefined,
      SENTRY_ENVIRONMENT: undefined,
      APP_RELEASE: undefined,
    });
  });

  it('accepts an internal API origin without a public suffix', () => {
    expect(
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        API_INTERNAL_URL: 'http://api:4000',
      }).API_INTERNAL_URL,
    ).toBe('http://api:4000');
    expect(() =>
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        API_INTERNAL_URL: 'not a url',
      }),
    ).toThrow(/API_INTERNAL_URL/);
  });

  it('rejects a heartbeat interval below one second', () => {
    expect(() =>
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        WORKER_HEARTBEAT_INTERVAL_MS: '10',
      }),
    ).toThrow(/WORKER_HEARTBEAT_INTERVAL_MS/);
  });

  it('requires REDIS_URL', () => {
    expect(() => loadWorkerEnv({})).toThrow(EnvValidationError);
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadWorkerEnv({ REDIS_URL: 'redis://redis:6379' })).toThrow(/DATABASE_URL/);
  });
});
