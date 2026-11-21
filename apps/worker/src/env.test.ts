import { EnvValidationError } from '@smsvio/shared';
import { describe, expect, it } from 'vitest';

import { loadWorkerEnv } from './env.js';

const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('loadWorkerEnv', () => {
  it('applies defaults', () => {
    expect(
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        APP_ENCRYPTION_KEY: KEY,
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
      APP_ENCRYPTION_KEY: KEY,
      PUBLIC_ORIGIN: undefined,
      EMAIL_MODE: 'disabled',
      SMTP_HOST: undefined,
      SMTP_PORT: 587,
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
      SMTP_FROM: undefined,
      SENT_DM_API_KEY: undefined,
      SENT_DM_BASE_URL: 'https://api.sent.dm',
      SENT_DM_WEBHOOK_SECRET: undefined,
      SENT_DM_SANDBOX: false,
    });
  });

  it('accepts an internal API origin without a public suffix', () => {
    expect(
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        APP_ENCRYPTION_KEY: KEY,
        API_INTERNAL_URL: 'http://api:4000',
      }).API_INTERNAL_URL,
    ).toBe('http://api:4000');
    expect(() =>
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        APP_ENCRYPTION_KEY: KEY,
        API_INTERNAL_URL: 'not a url',
      }),
    ).toThrow(/API_INTERNAL_URL/);
  });

  it('keeps a Sent API key and rejects a non-https base URL', () => {
    const key = 'sent-test-key';
    expect(
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        APP_ENCRYPTION_KEY: KEY,
        SENT_DM_API_KEY: key,
      }).SENT_DM_API_KEY,
    ).toBe(key);
    expect(() =>
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        APP_ENCRYPTION_KEY: KEY,
        SENT_DM_BASE_URL: 'http://api.sent.dm',
      }),
    ).toThrow(/SENT_DM_BASE_URL/);
  });

  it('rejects a heartbeat interval below one second', () => {
    expect(() =>
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        APP_ENCRYPTION_KEY: KEY,
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

  it('requires the encryption key', () => {
    expect(() =>
      loadWorkerEnv({
        REDIS_URL: 'redis://redis:6379',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
      }),
    ).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
