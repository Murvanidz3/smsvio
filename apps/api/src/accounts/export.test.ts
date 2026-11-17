import { describe, expect, it } from 'vitest';

import { ApiError } from '../http/api-error.js';
import { TeamService } from './team.service.js';
import type { AuthState } from './support.js';

const owner = {
  userId: 'user-1',
  sessionId: 'session-1',
  organizationId: 'org-1',
  role: 'OWNER',
  body: {},
} as AuthState;

const client = { ip: '127.0.0.1', userAgent: null };

function service(db: object): TeamService {
  return new TeamService(db as never, {} as never, {} as never);
}

describe('organization export', () => {
  it('returns 404 when the organization is gone', async () => {
    const teams = service({
      organization: { findUnique: () => Promise.resolve(null) },
    });
    await expect(teams.exportOrganization(owner, client)).rejects.toBeInstanceOf(ApiError);
  });

  it('marks the file truncated when more messages exist than the cap', async () => {
    const teams = service({
      organization: {
        findUnique: () =>
          Promise.resolve({
            id: 'org-1',
            name: 'Ada',
            legalName: null,
            status: 'ACTIVE',
            timezone: 'UTC',
            messageRetentionDays: 365,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
      },
      membership: {
        findMany: () =>
          Promise.resolve([
            { user: { email: 'ada@example.com', name: 'Ada' }, role: 'OWNER', status: 'ACTIVE' },
          ]),
      },
      contact: { findMany: () => Promise.resolve([]) },
      template: { findMany: () => Promise.resolve([]) },
      message: {
        findMany: () => Promise.resolve([{ id: 'm-1', body: 'kept' }]),
        count: () => Promise.resolve(2),
      },
      senderId: {
        findMany: () => Promise.resolve([{ value: 'ADA', type: 'ALPHANUMERIC', status: 'ACTIVE' }]),
      },
      optOut: {
        findMany: () => Promise.resolve([{ phoneE164: '+15550001111', source: 'keyword' }]),
      },
      auditLog: { create: () => Promise.resolve({}) },
    });
    const exported = await teams.exportOrganization(owner, client);
    expect(exported.messagesTruncated).toBe(true);
    expect(exported.members[0]?.email).toBe('ada@example.com');
    expect(exported.optOuts).toEqual([{ phoneE164: '+15550001111', source: 'keyword' }]);
  });
});
