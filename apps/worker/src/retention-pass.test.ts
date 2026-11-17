import { describe, expect, it } from 'vitest';

import { REDACTED_BODY, redactExpiredBodies } from './retention-pass.js';

describe('message retention', () => {
  it('redacts bodies older than the organization window and leaves recent ones', async () => {
    const now = new Date('2026-11-17T00:00:00.000Z');
    const old = new Date('2024-01-01T00:00:00.000Z');
    const recent = new Date('2026-11-01T00:00:00.000Z');
    const rows = [
      { organizationId: 'org-1', createdAt: old, body: 'secret' },
      { organizationId: 'org-1', createdAt: recent, body: 'still kept' },
      { organizationId: 'org-1', createdAt: old, body: REDACTED_BODY },
      { organizationId: 'org-2', createdAt: old, body: 'other' },
    ];
    const prisma = {
      organization: {
        findMany: () =>
          Promise.resolve([
            { id: 'org-1', messageRetentionDays: 365 },
            { id: 'org-2', messageRetentionDays: 0 },
          ]),
      },
      message: {
        updateMany: ({
          where,
          data,
        }: {
          where: {
            organizationId: string;
            createdAt: { lt: Date };
            body: { not: string };
          };
          data: { body: string };
        }) => {
          const hits = rows.filter(
            (row) =>
              row.organizationId === where.organizationId &&
              row.createdAt < where.createdAt.lt &&
              row.body !== where.body.not,
          );
          for (const row of hits) {
            row.body = data.body;
          }
          return Promise.resolve({ count: hits.length });
        },
      },
    };
    expect(await redactExpiredBodies(prisma as never, now)).toBe(1);
    expect(rows[0]?.body).toBe(REDACTED_BODY);
    expect(rows[1]?.body).toBe('still kept');
    expect(rows[3]?.body).toBe('other');
  });
});
