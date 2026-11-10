import { beforeEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn();
vi.mock('@sentry/nestjs', () => ({ init }));

const { initSentry, initSentryFromEnv } = await import('./sentry.js');

describe('initSentryFromEnv', () => {
  it('stays disabled when SENTRY_DSN is empty', () => {
    init.mockClear();
    expect(initSentryFromEnv('api', { SENTRY_DSN: '' })).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('defaults the environment to NODE_ENV and passes the release', () => {
    init.mockClear();
    const enabled = initSentryFromEnv('worker', {
      NODE_ENV: 'production',
      SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
      APP_RELEASE: 'sha-abc',
    });
    expect(enabled).toBe(true);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'production', release: 'sha-abc' }),
    );
  });

  it('prefers SENTRY_ENVIRONMENT', () => {
    init.mockClear();
    initSentryFromEnv('api', {
      NODE_ENV: 'production',
      SENTRY_ENVIRONMENT: 'staging',
      SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
    });
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ environment: 'staging' }));
  });
});

beforeEach(() => {
  init.mockClear();
});

describe('initSentry', () => {
  it('does nothing without a DSN', () => {
    expect(
      initSentry({ dsn: undefined, environment: 'production', release: 'abc', service: 'api' }),
    ).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('initialises with privacy-preserving data collection', () => {
    const dsn = 'https://key@o1.ingest.sentry.io/1';
    expect(initSentry({ dsn, environment: 'production', release: 'sha-1', service: 'api' })).toBe(
      true,
    );
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn,
        environment: 'production',
        release: 'sha-1',
        initialScope: { tags: { service: 'api' } },
        dataCollection: expect.objectContaining({
          userInfo: false,
          cookies: false,
          httpBodies: [],
          urlQueryParams: false,
        }) as unknown,
      }),
    );
  });

  it('omits the release when it is unknown', () => {
    initSentry({
      dsn: 'https://key@o1.ingest.sentry.io/1',
      environment: 'development',
      release: undefined,
      service: 'worker',
    });
    expect(init.mock.calls[0]?.[0]).not.toHaveProperty('release');
  });
});
