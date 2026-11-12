import { randomUUID } from 'node:crypto';

import type { MembershipRole } from '@smsvio/shared';
import { describe, expect, it } from 'vitest';

import type { AuthState } from '../accounts/support.js';
import { createMemoryDb } from '../memory-db.js';
import { MessageQueryService, readMessageExport } from './messages.service.js';

function state(organizationId: string): AuthState {
  return {
    userId: randomUUID(),
    sessionId: randomUUID(),
    organizationId,
    role: 'VIEWER' satisfies MembershipRole,
    body: { user: { isPlatformAdmin: false } },
  } as AuthState;
}

describe('message query', () => {
  it('lists a message and returns its events', async () => {
    const db = createMemoryDb();
    const organization = await db.organization.create({ data: { name: 'Readers' } });
    const template = await db.template.create({
      data: {
        organizationId: organization.id,
        createdById: null,
        name: 'Hello',
        category: 'UTILITY',
        language: 'en',
        body: 'Hello',
        variables: [],
        status: 'APPROVED',
      },
    });
    const message = await db.message.create({
      data: {
        organizationId: organization.id,
        direction: 'OUTBOUND',
        to: '+4915123456789',
        fromSender: '12025550199',
        body: 'Hello',
        status: 'DELIVERED',
        templateId: template.id,
        priceMicros: 15_000n,
        countryIso2: 'DE',
      },
    });
    await db.messageEvent.create({
      data: { messageId: message.id, status: 'DELIVERED', detail: 'Delivery receipt.' },
    });
    const query = new MessageQueryService(db as never);
    const auth = state(organization.id);
    const page = await query.list(auth, { q: '4915', page: 1, pageSize: 25 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.templateName).toBe('Hello');
    const detail = await query.get(auth, message.id);
    expect(detail.body).toBe('Hello');
    expect(detail.events).toHaveLength(1);
    expect(detail.error).toBeNull();
    await db.message.create({
      data: {
        organizationId: organization.id,
        direction: 'OUTBOUND',
        to: '+4915112345678',
        fromSender: '12025550199',
        body: 'Failed',
        status: 'FAILED',
        errorCode: 'no_route',
        priceMicros: null,
      },
    });
    const failed = await query.list(auth, {
      status: 'FAILED',
      direction: 'OUTBOUND',
      country: 'DE',
      templateId: template.id,
      page: 1,
      pageSize: 25,
    });
    expect(failed.total).toBe(0);
    const explained = await query.list(auth, { q: '', page: 1, pageSize: 25 });
    expect(explained.total).toBe(2);
    const failedRow = await db.message.findFirst({
      where: { organizationId: organization.id, status: 'FAILED' },
    });
    const withError = await query.get(auth, failedRow?.id ?? '');
    expect(withError.error).toBe('No route is available for that destination.');
    await expect(query.get(auth, randomUUID())).rejects.toMatchObject({ code: 'not_found' });
    const today = new Date().toISOString().slice(0, 10);
    const ranged = await query.list(auth, { from: today, to: today, page: 1, pageSize: 25 });
    expect(ranged.total).toBe(2);
    const older = await query.list(auth, {
      from: '2000-01-01',
      to: '2000-01-01',
      page: 1,
      pageSize: 25,
    });
    expect(older.total).toBe(0);
    const exported = await query.export(auth, { page: 1, pageSize: 25 });
    expect(exported.kind).toBe('csv');
    if (exported.kind === 'csv') {
      expect(exported.body).toContain(message.id);
    }
    const live = await query.activity(auth, [message.id, randomUUID()]);
    expect(live).toHaveLength(1);
    expect(live[0]?.events[0]?.detail).toBe('Delivery receipt.');
    expect(await readMessageExport({ get: () => Promise.resolve('csv') }, 'short')).toBeNull();
    expect(await readMessageExport({ get: () => Promise.resolve('csv') }, 'a'.repeat(32))).toBe(
      'csv',
    );
  });
});
