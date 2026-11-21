import { describe, expect, it, vi } from 'vitest';

import type { WorkerEnv } from './env.js';
import { notifyOwners, WebhookLoop } from './webhook-loop.js';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(() => Promise.resolve({ messageId: '1' })),
    })),
  },
}));

const env: WorkerEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  REDIS_URL: 'redis://redis:6379',
  DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
  DATABASE_POOL_MAX: 2,
  WORKER_HEARTBEAT_INTERVAL_MS: 10_000,
  SENTRY_DSN: undefined,
  SENTRY_ENVIRONMENT: undefined,
  APP_RELEASE: undefined,
  APP_ENCRYPTION_KEY: 'ab'.repeat(32),
  PUBLIC_ORIGIN: 'https://smsvio.com',
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
};

describe('webhook loop', () => {
  it('logs when mail is disabled and still reports the endpoint disabled', async () => {
    const notes: string[] = [];
    await notifyOwners(
      {} as never,
      env,
      { organizationId: 'org', name: 'Primary', url: 'https://example.com/hooks' },
      (message) => {
        notes.push(message);
      },
    );
    expect(notes[0]).toContain('Email is not configured');
  });

  it('mails owners when SMTP is configured', async () => {
    const prisma = {
      membership: {
        findMany: () =>
          Promise.resolve([
            { user: { email: 'owner@example.com' } },
            { user: { email: 'admin@example.com' } },
          ]),
      },
    };
    await notifyOwners(
      prisma as never,
      {
        ...env,
        EMAIL_MODE: 'smtp',
        SMTP_HOST: 'mail.example.com',
        SMTP_FROM: 'SMSVIO <noreply@smsvio.com>',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'secret',
      },
      { organizationId: 'org', name: 'Primary', url: 'https://example.com/hooks' },
      () => undefined,
    );
  });

  it('drains an empty queue and keeps running after a tick error', async () => {
    const redis = {
      zrangebyscore: vi.fn(() => Promise.resolve([])),
      rpop: vi.fn(() => Promise.resolve(null)),
    };
    const loop = new WebhookLoop({} as never, redis as never, env);
    await loop.tick(1);
    redis.zrangebyscore.mockRejectedValueOnce(new Error('redis down'));
    await loop.tick(2);
    loop.onApplicationBootstrap();
    loop.onApplicationShutdown();
  });
});
