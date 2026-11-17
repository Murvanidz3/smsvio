import { describe, expect, it, vi } from 'vitest';

import { notifyLowBalances, refreshUsage } from './usage-pass.js';

describe('usage pass', () => {
  it('stores one daily row per organization', async () => {
    const upserts: unknown[] = [];
    const prisma = {
      organization: { findMany: () => Promise.resolve([{ id: 'org-1' }]) },
      message: {
        findMany: () =>
          Promise.resolve([
            {
              createdAt: new Date(),
              status: 'DELIVERED',
              priceMicros: 15_000n,
              billable: true,
            },
          ]),
      },
      dailyUsage: {
        upsert: (args: unknown) => {
          upserts.push(args);
          return Promise.resolve({});
        },
      },
    };
    await refreshUsage(prisma as never);
    expect(upserts.length).toBe(90);
  });

  it('mails once under the threshold, then clears the notice when the balance recovers', async () => {
    const sent: string[] = [];
    let notified: Date | null = null;
    let available = 1n;
    const profile = () => ({
      organizationId: 'org-1',
      email: 'billing@example.com',
      lowBalanceMicros: 1_000_000n,
      lowBalanceNotifiedAt: notified,
    });
    const prisma = {
      billingProfile: {
        findMany: () => Promise.resolve([profile(), { ...profile(), lowBalanceMicros: null }]),
        update: ({ data }: { data: { lowBalanceNotifiedAt: Date | null } }) => {
          notified = data.lowBalanceNotifiedAt;
          return Promise.resolve(profile());
        },
      },
      orgBalance: {
        findUnique: () => Promise.resolve({ availableMicros: available }),
      },
      membership: {
        findMany: () =>
          Promise.resolve([{ user: { email: 'owner@example.com' } }, { user: { email: '' } }]),
      },
    };
    const env = {
      EMAIL_MODE: 'smtp' as const,
      SMTP_HOST: 'mail.example.com',
      SMTP_FROM: 'SMSVIO <noreply@smsvio.com>',
      PUBLIC_ORIGIN: 'https://smsvio.com',
    };
    await notifyLowBalances(
      prisma as never,
      env,
      {
        send: (message) => {
          sent.push(message.to);
          return Promise.resolve();
        },
      },
      () => undefined,
    );
    expect(sent.sort()).toEqual(['billing@example.com', 'owner@example.com']);
    expect(notified).toBeInstanceOf(Date);
    sent.length = 0;
    await notifyLowBalances(
      prisma as never,
      env,
      { send: () => Promise.resolve() },
      () => undefined,
    );
    expect(sent).toEqual([]);
    available = 2_000_000n;
    await notifyLowBalances(
      prisma as never,
      env,
      { send: () => Promise.resolve() },
      () => undefined,
    );
    expect(notified).toBeNull();
  });

  it('marks the notice without mailing when email is disabled', async () => {
    const log = vi.fn();
    let notified: Date | null = null;
    const prisma = {
      billingProfile: {
        findMany: () =>
          Promise.resolve([
            {
              organizationId: 'org-1',
              email: null,
              lowBalanceMicros: 5n,
              lowBalanceNotifiedAt: null,
            },
          ]),
        update: ({ data }: { data: { lowBalanceNotifiedAt: Date | null } }) => {
          notified = data.lowBalanceNotifiedAt;
          return Promise.resolve({});
        },
      },
      orgBalance: { findUnique: () => Promise.resolve(null) },
    };
    await notifyLowBalances(
      prisma as never,
      { EMAIL_MODE: 'disabled' },
      { send: () => Promise.reject(new Error('should not send')) },
      log,
    );
    expect(log).toHaveBeenCalledOnce();
    expect(notified).toBeInstanceOf(Date);
  });
});
