import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import { UsageLoop } from './usage-loop.js';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: vi.fn(() => Promise.resolve({})) })),
  },
}));

const env = {
  EMAIL_MODE: 'disabled' as const,
  SMTP_PORT: 587,
};

function idlePrisma() {
  return {
    organization: { findMany: () => Promise.resolve([]) },
    billingProfile: { findMany: () => Promise.resolve([]) },
  };
}

describe('usage loop', () => {
  it('logs a failed pass', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const loop = new UsageLoop(
      { organization: { findMany: () => Promise.reject(new Error('down')) } } as never,
      env as never,
    );
    await loop.tick();
    expect(errorSpy).toHaveBeenCalledWith('Usage pass failed: down');
    expect(errorSpy).toHaveBeenCalledWith('Retention pass failed: down');
    loop.onApplicationShutdown();
  });

  it('does not start a second pass while the first is still running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const prisma = idlePrisma();
    prisma.organization.findMany = () => {
      started += 1;
      return gate.then(() => []);
    };
    const loop = new UsageLoop(prisma as never, env as never);
    const first = loop.tick();
    await loop.tick();
    expect(started).toBe(1);
    release();
    await first;
    loop.onApplicationShutdown();
  });

  it('logs how many bodies were redacted', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const loop = new UsageLoop(
      {
        organization: {
          findMany: () => Promise.resolve([{ id: 'org-1', messageRetentionDays: 30 }]),
        },
        message: {
          findMany: () => Promise.resolve([]),
          updateMany: () => Promise.resolve({ count: 2 }),
        },
        dailyUsage: { upsert: () => Promise.resolve({}) },
        billingProfile: { findMany: () => Promise.resolve([]) },
      } as never,
      env as never,
    );
    await loop.tick();
    expect(logSpy).toHaveBeenCalledWith('Redacted 2 message bodies past retention.');
    loop.onApplicationShutdown();
  });

  it('mails a low balance over SMTP and again without credentials', async () => {
    const prisma = lowBalancePrisma();
    const secure = new UsageLoop(
      prisma as never,
      {
        EMAIL_MODE: 'smtp',
        SMTP_HOST: 'smtp.example',
        SMTP_PORT: 465,
        SMTP_USER: 'mailer',
        SMTP_PASSWORD: 'secret',
        SMTP_FROM: 'SMSVIO <notify@example.com>',
      } as never,
    );
    await secure.tick();
    const plain = new UsageLoop(
      lowBalancePrisma() as never,
      {
        EMAIL_MODE: 'smtp',
        SMTP_HOST: 'smtp.example',
        SMTP_PORT: 587,
        SMTP_FROM: 'SMSVIO <notify@example.com>',
      } as never,
    );
    await plain.tick();
    expect(nodemailer.createTransport).toHaveBeenCalled();
    secure.onApplicationShutdown();
    plain.onApplicationShutdown();
  });
});

function lowBalancePrisma() {
  return {
    organization: { findMany: () => Promise.resolve([]) },
    billingProfile: {
      findMany: () =>
        Promise.resolve([
          {
            organizationId: 'org-1',
            lowBalanceMicros: 1_000_000n,
            lowBalanceNotifiedAt: null,
            email: 'billing@example.com',
          },
        ]),
      update: () => Promise.resolve({}),
    },
    orgBalance: { findUnique: () => Promise.resolve({ availableMicros: 0n }) },
    membership: {
      findMany: () => Promise.resolve([{ user: { email: 'owner@example.com' } }]),
    },
  };
}
