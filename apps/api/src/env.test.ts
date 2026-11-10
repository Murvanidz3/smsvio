import { EnvValidationError } from '@smsvio/shared';
import { describe, expect, it } from 'vitest';

import { loadApiEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
  REDIS_URL: 'redis://:pw@redis:6379',
};

describe('loadApiEnv', () => {
  it('applies defaults', () => {
    expect(loadApiEnv(base)).toEqual({
      ...base,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_HOST: '0.0.0.0',
      API_PORT: 4000,
      DATABASE_POOL_MAX: 10,
      TRUST_PROXY_HOPS: 1,
      READINESS_TIMEOUT_MS: 2000,
      SENTRY_DSN: undefined,
      SENTRY_ENVIRONMENT: undefined,
      APP_RELEASE: undefined,
    });
  });

  it('parses overrides', () => {
    const env = loadApiEnv({
      ...base,
      NODE_ENV: 'production',
      API_PORT: '4100',
      TRUST_PROXY_HOPS: '0',
      APP_RELEASE: 'sha-abc123',
      SENTRY_DSN: '',
    });
    expect(env.API_PORT).toBe(4100);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.APP_RELEASE).toBe('sha-abc123');
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('fails fast naming the missing variables', () => {
    expect(() => loadApiEnv({})).toThrow(EnvValidationError);
    expect(() => loadApiEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });
});
