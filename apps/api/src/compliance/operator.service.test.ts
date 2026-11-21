import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AuthState } from '../accounts/support.js';
import { createMemoryDb, createMemoryRedis } from '../memory-db.js';
import { OperatorService } from './operator.service.js';

function admin(): AuthState {
  return {
    userId: randomUUID(),
    sessionId: randomUUID(),
    organizationId: null,
    role: null,
    body: { user: { isPlatformAdmin: true } },
  } as AuthState;
}

describe('operator traffic', () => {
  it('summarizes routes, pauses sending, and groups failures', async () => {
    const db = createMemoryDb();
    const service = new OperatorService(db as never, createMemoryRedis() as never, {
      send: () => Promise.resolve(),
    });
    const state = admin();
    const organization = await db.organization.create({
      data: { name: 'North', status: 'ACTIVE' },
    });
    await db.country.create({
      data: {
        iso2: 'DE',
        name: 'Germany',
        dialCode: '49',
        alphaSenderAllowed: true,
        registrationRequired: false,
      },
    });
    const provider = await db.provider.create({
      data: {
        code: 'mock',
        type: 'MOCK',
        status: 'ACTIVE',
        maxTps: 20,
        markupPercent: 50,
        configEnc: null,
        callbackSecretHash: null,
      },
    });
    const route = await db.route.create({
      data: {
        countryIso2: 'DE',
        providerId: provider.id,
        priority: 1,
        weight: 1,
        costMicros: 10_000n,
        mccmnc: null,
      },
    });
    const statuses = [
      'QUEUED',
      'SENDING',
      'SENT',
      'DELIVERED',
      'FAILED',
      'REJECTED',
      'UNDELIVERED',
      'EXPIRED',
    ] as const;
    for (const status of statuses) {
      const row = await db.message.create({
        data: {
          organizationId: organization.id,
          to: '+4915123456789',
          body: 'Hello',
          direction: 'OUTBOUND',
          status,
          routeId: status === 'EXPIRED' ? null : route.id,
          errorCode: status === 'FAILED' ? 'no_route' : null,
          countryIso2: 'DE',
        },
      });
      if (status === 'SENT') {
        await db.message.update({
          where: { id: row.id },
          data: { sentAt: new Date(Date.now() - 10 * 60 * 1000) },
        });
      }
    }
    const fresh = await db.message.create({
      data: {
        organizationId: organization.id,
        to: '+4915111111111',
        body: 'Now',
        direction: 'OUTBOUND',
        status: 'SENT',
        routeId: route.id,
        countryIso2: 'DE',
      },
    });
    await db.message.update({
      where: { id: fresh.id },
      data: { sentAt: new Date() },
    });

    const operations = await service.operations(state);
    expect(operations.paused).toBe(false);
    expect(operations.today.total).toBe(9);
    expect(operations.today.delivered).toBe(1);
    expect(operations.today.failed).toBe(3);
    expect(operations.today.deliveryRate).toBe(20);
    expect(operations.routes[0]?.lastMinute).toBe(1);
    expect(operations.open).toHaveLength(2);
    const paused = await service.setSendingPaused(state, true, { ip: null, userAgent: null });
    expect(paused.message).toBe('Sending is paused.');
    expect((await service.operations(state)).paused).toBe(true);

    const statistics = await service.statistics(state, undefined);
    expect(statistics.byOrganization[0]?.name).toBe('North');
    expect(statistics.byRoute.some((row) => row.providerCode === '')).toBe(true);
    await expect(service.statistics(state, '2026-02-31')).rejects.toMatchObject({
      code: 'invalid_input',
    });

    const health = await service.health(state);
    expect(health.stuck.length).toBeGreaterThan(0);
    expect(health.errorGroups.some((group) => group.errorCode === 'no_route')).toBe(true);
    const messages = await service.messages(state, {
      status: 'FAILED',
      errorCode: 'no_route',
      page: 1,
      pageSize: 25,
    });
    expect(messages.total).toBe(1);
  });
});
