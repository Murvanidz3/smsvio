import type { PrismaClient } from '@smsvio/db';

export const REDACTED_BODY = '[redacted]';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Replaces message bodies older than the organization's retention window.
 * The row, status, and price stay so billing history still adds up.
 */
export async function redactExpiredBodies(prisma: PrismaClient, now = new Date()): Promise<number> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, messageRetentionDays: true },
  });
  let redacted = 0;
  for (const organization of organizations) {
    if (organization.messageRetentionDays < 1) {
      continue;
    }
    const cutoff = new Date(now.getTime() - organization.messageRetentionDays * DAY_MS);
    const result = await prisma.message.updateMany({
      where: {
        organizationId: organization.id,
        createdAt: { lt: cutoff },
        body: { not: REDACTED_BODY },
      },
      data: { body: REDACTED_BODY },
    });
    redacted += result.count;
  }
  return redacted;
}
