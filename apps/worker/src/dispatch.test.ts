import { randomUUID } from 'node:crypto';

import { RECEIPT_QUEUE_KEY, SEND_QUEUE_KEY, sendLockKey } from '@smsvio/shared';
import { describe, expect, it, vi } from 'vitest';

import { runSendTick, type SendRedis } from './dispatch.js';
import { SendLoop } from './send-loop.js';

interface Row {
  id: string;
  organizationId: string;
  to: string;
  fromSender: string;
  body: string;
  encoding: string;
  segments: number;
  countryIso2: string | null;
  mccmnc: string | null;
  status: string;
  errorCode: string | null;
  providerId: string | null;
  providerMessageId: string | null;
  routeId: string | null;
  priceMicros: bigint | null;
  costMicros: bigint | null;
  attempt: number;
  failedRouteIds: string[];
  queuedAt: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  updatedAt: Date;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const value = row[key as keyof Row];
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
      const filter = expected as { in?: unknown[]; lt?: Date };
      if (filter.in !== undefined && !filter.in.includes(value)) {
        return false;
      }
      if (
        filter.lt instanceof Date &&
        (!(value instanceof Date) || value.getTime() >= filter.lt.getTime())
      ) {
        return false;
      }
      continue;
    }
    if (value !== expected) {
      return false;
    }
  }
  return true;
}

function harness() {
  const messages = new Map<string, Row>();
  const events: { messageId: string; status: string }[] = [];
  const ledger: { type: string; refId: string; amountMicros: bigint }[] = [];
  const balances = new Map<string, { availableMicros: bigint; heldMicros: bigint }>();
  const routes: {
    id: string;
    countryIso2: string;
    mccmnc: string | null;
    providerId: string;
    priority: number;
    weight: number;
    enabled: boolean;
    costMicros: bigint;
  }[] = [];
  const providers: {
    id: string;
    code: string;
    type: string;
    status: string;
    maxTps: number;
    callbackSecretHash: string | null;
  }[] = [];
  const lists = new Map<string, string[]>();
  const scores = new Map<string, Map<string, number>>();
  const locks = new Set<string>();
  const missed = new Set<string>();
  const counters = new Map<string, number>();

  const store = {
    message: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(messages.get(where.id) ?? null),
      findFirst: ({ where }: { where: { providerMessageId?: string } }) =>
        Promise.resolve(
          [...messages.values()].find(
            (row) =>
              where.providerMessageId === undefined ||
              row.providerMessageId === where.providerMessageId,
          ) ?? null,
        ),
      findMany: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve([...messages.values()].filter((row) => matches(row, where))),
      update: ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = messages.get(where.id);
        if (row === undefined) {
          throw new Error('missing');
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const rows = [...messages.values()].filter((row) => matches(row, where));
        for (const row of rows) {
          Object.assign(row, data, { updatedAt: new Date() });
        }
        return Promise.resolve({ count: rows.length });
      },
    },
    messageEvent: {
      create: ({ data }: { data: { messageId: string; status: string } }) => {
        events.push(data);
        return Promise.resolve(data);
      },
    },
    route: { findMany: () => Promise.resolve(routes) },
    provider: { findMany: () => Promise.resolve(providers) },
    orgBalance: {
      findUnique: ({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(balances.get(where.organizationId) ?? null),
      updateMany: ({
        where,
        data,
      }: {
        where: { organizationId: string; heldMicros?: { gte: bigint } };
        data: {
          heldMicros?: { decrement: bigint };
          availableMicros?: { increment: bigint };
        };
      }) => {
        const row = balances.get(where.organizationId);
        if (
          row === undefined ||
          (where.heldMicros !== undefined && row.heldMicros < where.heldMicros.gte)
        ) {
          return Promise.resolve({ count: 0 });
        }
        if (data.heldMicros !== undefined) {
          row.heldMicros -= data.heldMicros.decrement;
        }
        if (data.availableMicros !== undefined) {
          row.availableMicros += data.availableMicros.increment;
        }
        return Promise.resolve({ count: 1 });
      },
    },
    ledgerEntry: {
      findFirst: ({ where }: { where: { refId: string; type: string | { in: string[] } } }) =>
        Promise.resolve(
          ledger.find((row) => {
            if (row.refId !== where.refId) {
              return false;
            }
            return typeof where.type === 'string'
              ? row.type === where.type
              : where.type.in.includes(row.type);
          }) ?? null,
        ),
      findMany: ({ where }: { where: { refId: string; type: { in: string[] } } }) =>
        Promise.resolve(
          ledger.filter((row) => row.refId === where.refId && where.type.in.includes(row.type)),
        ),
      create: ({ data }: { data: { type: string; refId: string; amountMicros: bigint } }) => {
        ledger.push(data);
        return Promise.resolve(data);
      },
    },
  };
  const db = {
    ...store,
    $transaction: (run: (client: typeof store) => Promise<unknown>) => run(store),
  };

  const redis: SendRedis = {
    lpush: (key, value) => {
      const list = lists.get(key) ?? [];
      list.unshift(value);
      lists.set(key, list);
      return Promise.resolve(list.length);
    },
    rpop: (key) => Promise.resolve((lists.get(key) ?? []).pop() ?? null),
    zadd: (key, score, member) => {
      const set = scores.get(key) ?? new Map<string, number>();
      set.set(member, score);
      scores.set(key, set);
      return Promise.resolve(1);
    },
    zrangebyscore: (key, min, max) => {
      const set = scores.get(key) ?? new Map<string, number>();
      return Promise.resolve(
        [...set.entries()]
          .filter(([, score]) => score >= Number(min) && score <= Number(max))
          .map(([member]) => member),
      );
    },
    zrem: (key, member) => {
      if (missed.has(member)) {
        return Promise.resolve(0);
      }
      return Promise.resolve(scores.get(key)?.delete(member) === true ? 1 : 0);
    },
    incr: (key) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return Promise.resolve(next);
    },
    expire: () => Promise.resolve(1),
    set: (key) => {
      if (locks.has(key)) {
        return Promise.resolve(null);
      }
      locks.add(key);
      return Promise.resolve('OK' as const);
    },
    del: (key) => {
      locks.delete(key);
      return Promise.resolve(1);
    },
  };

  return { db, redis, messages, events, ledger, balances, routes, providers, lists, missed };
}

function queueMessage(
  world: ReturnType<typeof harness>,
  to: string,
  organizationId: string,
): string {
  const id = randomUUID();
  world.messages.set(id, {
    id,
    organizationId,
    to,
    fromSender: '12025550199',
    body: 'Hello',
    encoding: 'GSM-7',
    segments: 1,
    countryIso2: 'DE',
    mccmnc: null,
    status: 'QUEUED',
    errorCode: null,
    providerId: null,
    providerMessageId: null,
    routeId: null,
    priceMicros: 15_000n,
    costMicros: null,
    attempt: 0,
    failedRouteIds: [],
    queuedAt: new Date(),
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    updatedAt: new Date(),
  });
  world.balances.set(organizationId, {
    availableMicros: 0n,
    heldMicros: (world.balances.get(organizationId)?.heldMicros ?? 0n) + 15_000n,
  });
  world.ledger.push({ type: 'HOLD', refId: id, amountMicros: -15_000n });
  const list = world.lists.get(SEND_QUEUE_KEY) ?? [];
  list.unshift(id);
  world.lists.set(SEND_QUEUE_KEY, list);
  return id;
}

describe('send dispatch', () => {
  it('charges each accepted message once and releases a permanent failure', async () => {
    const world = harness();
    const providerId = randomUUID();
    const routeId = randomUUID();
    world.providers.push({
      id: providerId,
      code: 'mock',
      type: 'MOCK',
      status: 'ACTIVE',
      maxTps: 1000,
      callbackSecretHash: null,
    });
    world.routes.push({
      id: routeId,
      countryIso2: 'DE',
      mccmnc: null,
      providerId,
      priority: 100,
      weight: 1,
      enabled: true,
      costMicros: 10_000n,
    });
    const organizationId = randomUUID();
    const ids = Array.from({ length: 25 }, () =>
      queueMessage(world, '+12025550100', organizationId),
    );
    const failed = queueMessage(world, '+12025551003', organizationId);
    const now = Date.now();
    await runSendTick(world.db as never, world.redis, now);
    await runSendTick(world.db as never, world.redis, now + 2000);

    for (const id of ids) {
      expect(world.messages.get(id)?.status).toBe('DELIVERED');
    }
    expect(world.messages.get(failed)?.status).toBe('FAILED');
    const charges = world.ledger.filter((row) => row.type === 'CHARGE');
    const releases = world.ledger.filter((row) => row.type === 'RELEASE');
    expect(charges).toHaveLength(25);
    expect(releases).toHaveLength(1);
    expect(new Set(charges.map((row) => row.refId)).size).toBe(25);
    expect(world.balances.get(organizationId)?.heldMicros).toBe(0n);

    const again = world.lists.get(SEND_QUEUE_KEY) ?? [];
    again.unshift(ids[0] ?? '');
    world.lists.set(SEND_QUEUE_KEY, again);
    await runSendTick(world.db as never, world.redis, now + 3000);
    expect(world.ledger.filter((row) => row.type === 'CHARGE')).toHaveLength(25);
  });

  it('retries a temporary failure, then expires a sent message and accepts a late receipt', async () => {
    const world = harness();
    const providerId = randomUUID();
    world.providers.push({
      id: providerId,
      code: 'mock',
      type: 'MOCK',
      status: 'ACTIVE',
      maxTps: 1,
      callbackSecretHash: null,
    });
    world.routes.push({
      id: randomUUID(),
      countryIso2: 'DE',
      mccmnc: null,
      providerId,
      priority: 100,
      weight: 1,
      enabled: true,
      costMicros: 10_000n,
    });
    const organizationId = randomUUID();
    const slow = queueMessage(world, '+12025551006', organizationId);
    const now = Date.now();
    await runSendTick(world.db as never, world.redis, now);
    expect(world.messages.get(slow)?.attempt).toBe(1);
    await runSendTick(world.db as never, world.redis, now + 1000);
    await runSendTick(world.db as never, world.redis, now + 4000);
    expect(world.messages.get(slow)?.status).toBe('FAILED');

    const blocked = queueMessage(world, '+12025550100', organizationId);
    await runSendTick(world.db as never, world.redis, now);
    expect(world.messages.get(blocked)?.status).toBe('SENDING');

    const staleId = randomUUID();
    world.messages.set(staleId, {
      id: staleId,
      organizationId,
      to: '+12025550100',
      fromSender: '12025550199',
      body: 'Hello',
      encoding: 'GSM-7',
      segments: 1,
      countryIso2: 'DE',
      mccmnc: null,
      status: 'SENT',
      errorCode: null,
      providerId,
      providerMessageId: 'mock_1',
      routeId: null,
      priceMicros: 15_000n,
      costMicros: 10_000n,
      attempt: 1,
      failedRouteIds: [],
      queuedAt: new Date(now),
      sentAt: new Date(now - 73 * 60 * 60 * 1000),
      deliveredAt: null,
      failedAt: null,
      updatedAt: new Date(now),
    });
    await runSendTick(world.db as never, world.redis, now + 5000);
    expect(world.messages.get(staleId)?.status).toBe('EXPIRED');
    await world.redis.zadd('smsvio:q:sms.dlr', now + 5000, `delivered:${staleId}`);
    await runSendTick(world.db as never, world.redis, now + 5000);
    expect(world.messages.get(staleId)?.status).toBe('DELIVERED');

    vi.useRealTimers();
    const loop = new SendLoop(world.db as never, world.redis as never);
    const pending = loop.tick(now + 6000);
    await loop.tick(now + 6000);
    await pending;
    loop.onApplicationBootstrap();
    loop.onApplicationShutdown();
    const failing = new SendLoop(
      {} as never,
      { zrangebyscore: () => Promise.reject(new Error('down')) } as never,
    );
    await failing.tick();
  });

  it('ignores a locked or unknown job and settles a hold only once', async () => {
    const world = harness();
    const providerId = randomUUID();
    const routeId = randomUUID();
    world.providers.push({
      id: providerId,
      code: 'mock',
      type: 'MOCK',
      status: 'ACTIVE',
      maxTps: 1000,
      callbackSecretHash: null,
    });
    world.routes.push({
      id: routeId,
      countryIso2: 'DE',
      mccmnc: null,
      providerId,
      priority: 100,
      weight: 1,
      enabled: true,
      costMicros: 10_000n,
    });
    world.routes.push({
      id: randomUUID(),
      countryIso2: 'DE',
      mccmnc: null,
      providerId: randomUUID(),
      priority: 1,
      weight: 1,
      enabled: true,
      costMicros: 10_000n,
    });
    const organizationId = randomUUID();
    const now = Date.now();
    const locked = queueMessage(world, '+12025550100', organizationId);
    await world.redis.set(sendLockKey(locked), '1', 'EX', 30, 'NX');
    const undelivered = queueMessage(world, '+12025551002', organizationId);
    const expired = queueMessage(world, '+12025551004', organizationId);
    const free = queueMessage(world, '+12025550100', organizationId);
    const mismatch = queueMessage(world, '+12025550100', organizationId);
    const preset = world.ledger.find((row) => row.refId === free);
    if (preset !== undefined) {
      preset.type = 'CHARGE';
    }
    const wrong = world.ledger.find((row) => row.refId === mismatch);
    if (wrong !== undefined) {
      wrong.amountMicros = -1n;
    }
    const zero = queueMessage(world, '+12025550100', organizationId);
    const zeroRow = world.messages.get(zero);
    if (zeroRow !== undefined) {
      zeroRow.priceMicros = 0n;
    }
    const stuck = queueMessage(world, '+12025550100', organizationId);
    const stuckRow = world.messages.get(stuck);
    if (stuckRow !== undefined) {
      stuckRow.queuedAt = new Date(now - 120_000);
    }
    const stuckList = world.lists.get(SEND_QUEUE_KEY) ?? [];
    world.lists.set(
      SEND_QUEUE_KEY,
      stuckList.filter((id) => id !== stuck),
    );
    world.lists.get(SEND_QUEUE_KEY)?.unshift(randomUUID());
    await world.redis.zadd(RECEIPT_QUEUE_KEY, now, 'skip:missing');
    world.missed.add('skip:missing');
    await runSendTick(world.db as never, world.redis, now);
    await runSendTick(world.db as never, world.redis, now + 2000);
    await runSendTick(world.db as never, world.redis, now + 4000);
    expect(world.messages.get(locked)?.status).toBe('QUEUED');
    expect(world.messages.get(undelivered)?.status).toBe('UNDELIVERED');
    expect(world.messages.get(expired)?.status).toBe('EXPIRED');
    expect(world.messages.get(free)?.status).toBe('DELIVERED');
    expect(world.messages.get(mismatch)?.status).toBe('DELIVERED');
    expect(world.messages.get(zero)?.status).toBe('DELIVERED');
    expect(world.ledger.filter((row) => row.refId === zero && row.type === 'CHARGE')).toHaveLength(
      0,
    );
    expect(
      world.ledger.filter((row) => row.refId === mismatch && row.type === 'CHARGE'),
    ).toHaveLength(0);
    expect(world.messages.get(stuck)?.status).toBe('DELIVERED');
  });

  it('ignores a receipt that cannot move the message and a hold that is already gone', async () => {
    const world = harness();
    const providerId = randomUUID();
    world.providers.push({
      id: providerId,
      code: 'mock',
      type: 'MOCK',
      status: 'ACTIVE',
      maxTps: 1000,
      callbackSecretHash: null,
    });
    world.routes.push({
      id: randomUUID(),
      countryIso2: 'DE',
      mccmnc: null,
      providerId,
      priority: 100,
      weight: 1,
      enabled: true,
      costMicros: 10_000n,
    });
    const organizationId = randomUUID();
    const now = Date.now();
    const id = queueMessage(world, '+12025550100', organizationId);
    const balance = world.balances.get(organizationId);
    if (balance !== undefined) {
      balance.heldMicros = 0n;
    }
    const failed = randomUUID();
    const source = world.messages.get(id);
    if (source === undefined) {
      throw new Error('missing queued message');
    }
    world.messages.set(failed, { ...source, id: failed, status: 'FAILED' });
    await world.redis.zadd(RECEIPT_QUEUE_KEY, now, 'noseparator');
    await world.redis.zadd(RECEIPT_QUEUE_KEY, now, 'failed:mock_x');
    await world.redis.zadd(RECEIPT_QUEUE_KEY, now, `delivered:${randomUUID()}`);
    await world.redis.zadd(RECEIPT_QUEUE_KEY, now, `delivered:${failed}`);
    await runSendTick(world.db as never, world.redis, now);
    expect(world.messages.get(id)?.status).toBe('SENT');
    expect(world.messages.get(failed)?.status).toBe('FAILED');
    expect(world.ledger.filter((row) => row.refId === id && row.type === 'CHARGE')).toHaveLength(0);
  });

  it('posts a delivery receipt to the hook and retries when that post fails', async () => {
    const world = harness();
    const providerId = randomUUID();
    world.providers.push({
      id: providerId,
      code: 'mock',
      type: 'MOCK',
      status: 'ACTIVE',
      maxTps: 1000,
      callbackSecretHash: null,
    });
    world.routes.push({
      id: randomUUID(),
      countryIso2: 'DE',
      mccmnc: null,
      providerId,
      priority: 100,
      weight: 1,
      enabled: true,
      costMicros: 10_000n,
    });
    const previous = process.env.API_INTERNAL_URL;
    process.env.API_INTERNAL_URL = 'http://api:4000';
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const now = Date.now();
      const id = queueMessage(world, '+12025550100', randomUUID());
      await runSendTick(world.db as never, world.redis, now);
      await runSendTick(world.db as never, world.redis, now + 1000);
      await runSendTick(world.db as never, world.redis, now + 2000);
      expect(world.messages.get(id)?.status).toBe('SENT');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      process.env.API_INTERNAL_URL = '';
      const quiet = queueMessage(world, '+12025550100', randomUUID());
      await runSendTick(world.db as never, world.redis, now + 3000);
      await runSendTick(world.db as never, world.redis, now + 4000);
      expect(world.messages.get(quiet)?.status).toBe('DELIVERED');
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) {
        delete process.env.API_INTERNAL_URL;
      } else {
        process.env.API_INTERNAL_URL = previous;
      }
    }
  });
});
