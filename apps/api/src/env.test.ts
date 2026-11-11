import { EnvValidationError } from '@smsvio/shared';
import { describe, expect, it } from 'vitest';

import { loadApiEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
  REDIS_URL: 'redis://:pw@redis:6379',
  PUBLIC_ORIGIN: 'http://localhost:3000',
  APP_ENCRYPTION_KEY: 'ab'.repeat(32),
  SMTP_HOST: 'localhost',
  SMTP_FROM: 'SMSVIO <noreply@smsvio.test>',
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
      SMTP_PORT: 587,
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
      MAIL_SINK_DIR: undefined,
      EMAIL_MODE: 'disabled',
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      SEED_ADMIN_EMAIL: undefined,
      GOOGLE_AUTHORIZATION_ENDPOINT: undefined,
      GOOGLE_TOKEN_ENDPOINT: undefined,
      GOOGLE_JWKS_URI: undefined,
      GOOGLE_ISSUER: undefined,
      AUTO_APPROVE_TEMPLATES: 'false',
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

  it('rejects a mail sink and a half-configured SMTP account in production', () => {
    expect(() =>
      loadApiEnv({
        ...base,
        NODE_ENV: 'production',
        MAIL_SINK_DIR: '/tmp/mail',
        SMTP_USER: 'only-user',
      }),
    ).toThrow(/SMTP_USER[\s\S]*MAIL_SINK_DIR/);
  });

  it('boots without SMTP when email is disabled', () => {
    const { SMTP_HOST: _host, SMTP_FROM: _from, ...rest } = base;
    expect(loadApiEnv(rest).EMAIL_MODE).toBe('disabled');
  });

  it('requires SMTP settings only when email is sent', () => {
    const { SMTP_HOST: _host, SMTP_FROM: _from, ...rest } = base;
    expect(() => loadApiEnv({ ...rest, EMAIL_MODE: 'smtp' })).toThrow(/SMTP_HOST/);
  });

  it('requires both Google credentials', () => {
    expect(() => loadApiEnv({ ...base, GOOGLE_CLIENT_ID: 'client' })).toThrow(/GOOGLE_CLIENT_ID/);
    expect(
      loadApiEnv({ ...base, GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' })
        .GOOGLE_CLIENT_ID,
    ).toBe('client');
  });

  it('fails fast naming the missing variables', () => {
    expect(() => loadApiEnv({})).toThrow(EnvValidationError);
    expect(() => loadApiEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });
});
