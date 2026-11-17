import type { PrismaClient } from '@smsvio/db';
import { formatMicros, summarizeUsage, usageWindow } from '@smsvio/shared/billing';

export interface UsageMail {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface UsageMailEnv {
  readonly EMAIL_MODE: 'disabled' | 'smtp';
  readonly SMTP_HOST?: string;
  readonly SMTP_FROM?: string;
  readonly PUBLIC_ORIGIN?: string;
}

/** Rewrites the last 90 UTC days for every organization. */
export async function refreshUsage(prisma: PrismaClient, now = new Date()): Promise<void> {
  const window = usageWindow('90', now);
  if ('error' in window) {
    return;
  }
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  for (const organization of organizations) {
    const messages = await prisma.message.findMany({
      where: { organizationId: organization.id, createdAt: { gte: window.start } },
      select: { createdAt: true, status: true, priceMicros: true, billable: true },
    });
    const days = summarizeUsage(messages, window.start, window.days);
    for (const day of days) {
      const counts = {
        sent: day.sent,
        delivered: day.delivered,
        failed: day.failed,
        finalCount: day.finalCount,
        spendMicros: day.spendMicros,
      };
      await prisma.dailyUsage.upsert({
        where: { organizationId_day: { organizationId: organization.id, day: day.day } },
        create: { organizationId: organization.id, day: day.day, ...counts },
        update: counts,
      });
    }
  }
}

/**
 * Emails owners, admins, and billing members once when the available balance is under the
 * configured threshold. A later balance at or above the threshold arms the notice again.
 * Mail is skipped when SMTP is off, and the notice is still marked so the check does not repeat.
 */
export async function notifyLowBalances(
  prisma: PrismaClient,
  env: UsageMailEnv,
  mail: UsageMail,
  log: (message: string) => void,
): Promise<void> {
  const profiles = await prisma.billingProfile.findMany();
  for (const profile of profiles) {
    if (profile.lowBalanceMicros === null) {
      continue;
    }
    const balance = await prisma.orgBalance.findUnique({
      where: { organizationId: profile.organizationId },
    });
    const available = balance?.availableMicros ?? 0n;
    if (available >= profile.lowBalanceMicros) {
      if (profile.lowBalanceNotifiedAt !== null) {
        await prisma.billingProfile.update({
          where: { organizationId: profile.organizationId },
          data: { lowBalanceNotifiedAt: null },
        });
      }
      continue;
    }
    if (profile.lowBalanceNotifiedAt !== null) {
      continue;
    }
    const origin = env.PUBLIC_ORIGIN ?? 'https://smsvio.com';
    const text = `The available balance is ${formatMicros(available, 2)} USD, under the ${formatMicros(profile.lowBalanceMicros, 2)} USD notice.\n\n${origin}/dashboard/billing`;
    if (env.EMAIL_MODE === 'smtp' && env.SMTP_HOST !== undefined && env.SMTP_FROM !== undefined) {
      const members = await prisma.membership.findMany({
        where: {
          organizationId: profile.organizationId,
          status: 'ACTIVE',
          role: { in: ['OWNER', 'ADMIN', 'BILLING'] },
        },
        include: { user: { select: { email: true } } },
      });
      const addresses = new Set(
        members
          .map((member) => member.user.email)
          .filter((email): email is string => email.length > 0),
      );
      if (profile.email !== null && profile.email !== '') {
        addresses.add(profile.email);
      }
      for (const to of addresses) {
        await mail.send({ to, subject: 'SMSVIO balance is low', text });
      }
    } else {
      log(
        `Balance for ${profile.organizationId} is under the notice. Email is not configured, so nobody was mailed.`,
      );
    }
    await prisma.billingProfile.update({
      where: { organizationId: profile.organizationId },
      data: { lowBalanceNotifiedAt: new Date() },
    });
  }
}
