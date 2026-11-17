import { WEBHOOK_DELAY_KEY, WEBHOOK_QUEUE_KEY } from '@smsvio/shared';
import { createWebhookSecret, decryptString, encryptString } from '@smsvio/shared/developer';
import { describe, expect, it, vi } from 'vitest';

import type { SendRedis } from './dispatch.js';
import { runWebhookTick } from './webhook-deliver.js';

const KEY = 'ab'.repeat(32);

interface Endpoint {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  secretEnc: string;
  status: 'ACTIVE' | 'DISABLED';
  consecutiveFailures: number;
}

interface Delivery {
  id: string;
  endpointId: string;
  eventId: string;
  attempt: number;
  payload: unknown;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  responseStatus: number | null;
  responseMs: number | null;
  nextRetryAt: Date | null;
  endpoint?: Endpoint;
}

function world() {
  const endpoints = new Map<string, Endpoint>();
  const deliveries = new Map<string, Delivery>();
  const lists = new Map<string, string[]>();
  const scores = new Map<string, Map<string, number>>();
  const locks = new Map<string, string>();
  const prisma = {
    webhookDelivery: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const row = deliveries.get(where.id);
        if (row === undefined) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ ...row, endpoint: endpoints.get(row.endpointId) });
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<Delivery> }) => {
        const row = deliveries.get(where.id);
        if (row === undefined) {
          throw new Error('missing');
        }
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
    webhookEndpoint: {
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status?: Endpoint['status']; consecutiveFailures?: unknown };
      }) => {
        const row = endpoints.get(where.id);
        if (row === undefined) {
          throw new Error('missing');
        }
        applyFailures(row, data.consecutiveFailures);
        if (data.status !== undefined) {
          row.status = data.status;
        }
        return Promise.resolve(row);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; status: 'ACTIVE' };
        data: { status?: 'DISABLED'; consecutiveFailures?: unknown };
      }) => {
        const row = endpoints.get(where.id);
        if (row?.status !== where.status) {
          return Promise.resolve({ count: 0 });
        }
        if (data.status !== undefined) {
          row.status = data.status;
        }
        applyFailures(row, data.consecutiveFailures);
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const redis: SendRedis = {
    lpush: (key, value) => {
      const list = lists.get(key) ?? [];
      list.unshift(value);
      lists.set(key, list);
      return Promise.resolve(list.length);
    },
    rpop: (key) => Promise.resolve(lists.get(key)?.pop() ?? null),
    zadd: (key, score, member) => {
      const set = scores.get(key) ?? new Map<string, number>();
      set.set(member, score);
      scores.set(key, set);
      return Promise.resolve(1);
    },
    zrangebyscore: (key, min, max) => {
      const set = scores.get(key) ?? new Map<string, number>();
      const low = Number(min);
      const high = Number(max);
      return Promise.resolve(
        [...set.entries()]
          .filter(([, score]) => score >= low && score <= high)
          .map(([member]) => member),
      );
    },
    zrem: (key, member) => {
      const set = scores.get(key);
      if (set?.delete(member) === true) {
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    },
    incr: () => Promise.resolve(1),
    expire: () => Promise.resolve(1),
    set: (key, value, _expiry, _seconds, _mode) => {
      if (locks.has(key)) {
        return Promise.resolve(null);
      }
      locks.set(key, value);
      return Promise.resolve('OK');
    },
    del: (key) => {
      locks.delete(key);
      return Promise.resolve(1);
    },
  };
  return { endpoints, deliveries, lists, scores, locks, prisma, redis };
}

describe('runWebhookTick', () => {
  it('records a 2xx delivery and resets failures', async () => {
    const store = world();
    const secret = createWebhookSecret();
    store.endpoints.set('ep', {
      id: 'ep',
      organizationId: 'org',
      name: 'Primary',
      url: 'https://example.com/hooks',
      secretEnc: encryptString(secret, KEY),
      status: 'ACTIVE',
      consecutiveFailures: 3,
    });
    store.deliveries.set('d1', {
      id: 'd1',
      endpointId: 'ep',
      eventId: 'evt_1',
      attempt: 0,
      payload: { id: 'evt_1', type: 'message.sent' },
      status: 'PENDING',
      responseStatus: null,
      responseMs: null,
      nextRetryAt: null,
    });
    store.lists.set(WEBHOOK_QUEUE_KEY, ['d1']);
    const post = vi.fn(() => Promise.resolve({ status: 204, durationMs: 12 }));
    await runWebhookTick(store.prisma as never, store.redis, {
      now: 1_700_000_000_000,
      decrypt: (payload) => encryptRoundTrip(payload),
      post,
      notify: () => Promise.resolve(),
    });
    expect(post).toHaveBeenCalledOnce();
    expect(store.deliveries.get('d1')?.status).toBe('SUCCEEDED');
    expect(store.endpoints.get('ep')?.consecutiveFailures).toBe(0);
  });

  it('schedules a retry and disables the endpoint when the schedule is exhausted', async () => {
    const store = world();
    store.endpoints.set('ep', {
      id: 'ep',
      organizationId: 'org',
      name: 'Primary',
      url: 'https://example.com/hooks',
      secretEnc: encryptString(createWebhookSecret(), KEY),
      status: 'ACTIVE',
      consecutiveFailures: 0,
    });
    store.deliveries.set('d1', {
      id: 'd1',
      endpointId: 'ep',
      eventId: 'evt_1',
      attempt: 0,
      payload: { ok: true },
      status: 'PENDING',
      responseStatus: null,
      responseMs: null,
      nextRetryAt: null,
    });
    store.lists.set(WEBHOOK_QUEUE_KEY, ['d1']);
    await runWebhookTick(store.prisma as never, store.redis, {
      now: 1_000,
      decrypt: (payload) => encryptRoundTrip(payload),
      post: () => Promise.resolve({ status: 500, durationMs: 4 }),
      notify: () => Promise.resolve(),
    });
    expect(store.deliveries.get('d1')?.status).toBe('PENDING');
    expect(store.scores.get(WEBHOOK_DELAY_KEY)?.has('d1')).toBe(true);

    store.deliveries.set('d2', {
      id: 'd2',
      endpointId: 'ep',
      eventId: 'evt_2',
      attempt: 11,
      payload: { ok: true },
      status: 'PENDING',
      responseStatus: null,
      responseMs: null,
      nextRetryAt: null,
    });
    store.lists.set(WEBHOOK_QUEUE_KEY, ['d2']);
    const notify = vi.fn(() => Promise.resolve());
    await runWebhookTick(store.prisma as never, store.redis, {
      now: 2_000,
      decrypt: (payload) => encryptRoundTrip(payload),
      post: () => Promise.reject(new Error('down')),
      notify,
    });
    expect(store.deliveries.get('d2')?.status).toBe('FAILED');
    expect(store.endpoints.get('ep')?.status).toBe('DISABLED');
    expect(notify).toHaveBeenCalledOnce();
  });

  it('promotes a due retry and skips a delivery whose endpoint is disabled', async () => {
    const store = world();
    store.endpoints.set('ep', {
      id: 'ep',
      organizationId: 'org',
      name: 'Primary',
      url: 'https://example.com/hooks',
      secretEnc: 'x',
      status: 'DISABLED',
      consecutiveFailures: 1,
    });
    store.deliveries.set('d1', {
      id: 'd1',
      endpointId: 'ep',
      eventId: 'evt_1',
      attempt: 1,
      payload: {},
      status: 'PENDING',
      responseStatus: null,
      responseMs: null,
      nextRetryAt: null,
    });
    store.scores.set(WEBHOOK_DELAY_KEY, new Map([['d1', 50]]));
    await runWebhookTick(store.prisma as never, store.redis, {
      now: 100,
      decrypt: () => {
        throw new Error('unused');
      },
      post: () => Promise.resolve({ status: 200, durationMs: 1 }),
      notify: () => Promise.resolve(),
    });
    expect(store.deliveries.get('d1')?.status).toBe('FAILED');
  });
});

function applyFailures(row: Endpoint, value: unknown): void {
  if (typeof value === 'number') {
    row.consecutiveFailures = value;
    return;
  }
  if (typeof value === 'object' && value !== null && 'increment' in value) {
    const increment = value.increment;
    if (typeof increment === 'number') {
      row.consecutiveFailures += increment;
    }
  }
}

function encryptRoundTrip(payload: string): string {
  return payload.startsWith('v1.') ? decryptString(payload, KEY) : payload;
}
