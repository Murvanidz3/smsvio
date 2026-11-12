import type { Prisma, PrismaClient } from '@smsvio/db';
import { orderedRoutes } from '@smsvio/shared/billing';
import {
  MOCK_CALLBACK_SECRET,
  MockProvider,
  type ProviderSendResult,
} from '@smsvio/shared/provider';
import {
  CALLBACK_DELAY_KEY,
  MESSAGE_VALIDITY_MS,
  RECEIPT_QUEUE_KEY,
  SEND_ATTEMPTS_PER_ROUTE,
  SEND_DELAY_KEY,
  SEND_QUEUE_KEY,
  receiptMember,
  retryDelayMs,
  sendLockKey,
  transitionMessage,
} from '@smsvio/shared';

export interface SendRedis {
  lpush(key: string, value: string): Promise<unknown>;
  rpop(key: string): Promise<string | null>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zrem(key: string, member: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  set(key: string, value: string, expiry: 'EX', seconds: number, mode: 'NX'): Promise<'OK' | null>;
  del(key: string): Promise<unknown>;
}

type Tx = Prisma.TransactionClient;
type RouteRow = Awaited<ReturnType<PrismaClient['route']['findMany']>>[number];
type ProviderRow = Awaited<ReturnType<PrismaClient['provider']['findMany']>>[number];

const STUCK_MS = 45_000;
const SENDS_PER_TICK = 40;
const SEND_CONCURRENCY = 4;
const SIDE_EFFECTS_PER_TICK = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One pass of the send, receipt, and expiry queues.
 * A message is claimed with a Redis lock, so a duplicate queue entry does not send twice.
 */
export async function runSendTick(
  prisma: PrismaClient,
  redis: SendRedis,
  now = Date.now(),
): Promise<void> {
  await promote(redis, now);
  await deliverCallbacks(redis, now);
  await sendQueued(prisma, redis, now);
  await applyReceipts(prisma, redis, now);
  await expireSent(prisma, now);
  await requeueStuck(prisma, redis, now);
}

async function promote(redis: SendRedis, now: number): Promise<void> {
  const due = await redis.zrangebyscore(SEND_DELAY_KEY, 0, now);
  for (const id of due.slice(0, SIDE_EFFECTS_PER_TICK)) {
    const removed = await redis.zrem(SEND_DELAY_KEY, id);
    if (removed === 1) {
      await redis.lpush(SEND_QUEUE_KEY, id);
    }
  }
}

async function sendQueued(prisma: PrismaClient, redis: SendRedis, now: number): Promise<void> {
  const ids: string[] = [];
  for (let count = 0; count < SENDS_PER_TICK; count += 1) {
    const id = await redis.rpop(SEND_QUEUE_KEY);
    if (id === null) {
      break;
    }
    ids.push(id);
  }
  if (ids.length === 0) {
    return;
  }
  const [routes, providers] = await Promise.all([
    prisma.route.findMany(),
    prisma.provider.findMany(),
  ]);
  let next = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const id = ids.at(next);
      next += 1;
      if (id === undefined) {
        return;
      }
      await withLock(redis, id, async () => {
        await dispatchMessage(prisma, redis, id, now, routes, providers);
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, ids.length) }, () => run()));
}

async function withLock(redis: SendRedis, id: string, run: () => Promise<void>): Promise<void> {
  const locked = await redis.set(sendLockKey(id), '1', 'EX', 30, 'NX');
  if (locked !== 'OK') {
    return;
  }
  try {
    await run();
  } finally {
    await redis.del(sendLockKey(id));
  }
}

async function dispatchMessage(
  prisma: PrismaClient,
  redis: SendRedis,
  id: string,
  now: number,
  routes: RouteRow[],
  providers: ProviderRow[],
): Promise<void> {
  const message = await prisma.message.findUnique({ where: { id } });
  if (message === null || (message.status !== 'QUEUED' && message.status !== 'SENDING')) {
    return;
  }
  if (message.status === 'QUEUED') {
    const claimed = await prisma.message.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'SENDING' },
    });
    if (claimed.count !== 1) {
      return;
    }
    await prisma.messageEvent.create({
      data: { messageId: id, status: 'SENDING', detail: 'Handed to the provider.' },
    });
  }
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const candidates = orderedRoutes(
    routes.filter((route) => {
      const provider = providerById.get(route.providerId);
      return route.enabled && provider?.status === 'ACTIVE' && provider.type === 'MOCK';
    }),
    message.countryIso2 ?? '',
    message.mccmnc,
  ).filter((route) => !message.failedRouteIds.includes(route.id));

  let failed = [...message.failedRouteIds];
  let attempt = message.attempt;
  for (const route of candidates) {
    const provider = providerById.get(route.providerId);
    if (provider === undefined) {
      continue;
    }
    const second = Math.floor(now / 1000);
    const used = await redis.incr(`smsvio:tps:${provider.id}:${String(second)}`);
    if (used === 1) {
      await redis.expire(`smsvio:tps:${provider.id}:${String(second)}`, 2);
    }
    if (used > provider.maxTps) {
      await redis.zadd(SEND_DELAY_KEY, now + 250, id);
      return;
    }
    const mock = new MockProvider({
      code: provider.code,
      callbackSecretHash: provider.callbackSecretHash,
    });
    const result = await mock.send({
      to: message.to,
      from: message.fromSender,
      body: message.body,
      encoding: message.encoding,
      segments: message.segments,
    });
    if (result.status === 'accepted') {
      await markSent(prisma, redis, message, route.id, provider.id, route.costMicros, result, now);
      return;
    }
    if (result.status === 'temporary_failure' && attempt + 1 < SEND_ATTEMPTS_PER_ROUTE) {
      attempt += 1;
      await prisma.message.update({ where: { id }, data: { attempt } });
      await redis.zadd(SEND_DELAY_KEY, now + retryDelayMs(attempt, 0), id);
      return;
    }
    failed = [...failed, route.id];
    attempt = 0;
    await prisma.message.update({
      where: { id },
      data: { failedRouteIds: failed, attempt: 0 },
    });
  }
  await markFailed(prisma, message, 'no_route');
}

async function markSent(
  prisma: PrismaClient,
  redis: SendRedis,
  message: {
    id: string;
    organizationId: string;
    priceMicros: bigint | null;
    segments: number;
  },
  routeId: string,
  providerId: string,
  routeCostMicros: bigint,
  result: Extract<ProviderSendResult, { status: 'accepted' }>,
  now: number,
): Promise<void> {
  const price = message.priceMicros ?? 0n;
  const cost = routeCostMicros * BigInt(message.segments);
  await prisma.$transaction(async (tx) => {
    if (price > 0n) {
      await settle(tx, message.organizationId, price, message.id, 'CHARGE', 'Carrier accepted');
    }
    const updated = await tx.message.updateMany({
      where: { id: message.id, status: 'SENDING' },
      data: {
        status: 'SENT',
        providerId,
        providerMessageId: result.providerMessageId,
        routeId,
        costMicros: cost,
        sentAt: new Date(now),
        errorCode: null,
      },
    });
    if (updated.count === 1) {
      await tx.messageEvent.create({
        data: { messageId: message.id, status: 'SENT', detail: 'Accepted by the provider.' },
      });
    }
  });
  await redis.zadd(
    CALLBACK_DELAY_KEY,
    now + result.receipt.delayMs,
    JSON.stringify({ id: result.providerMessageId, status: result.receipt.status }),
  );
}

async function deliverCallbacks(redis: SendRedis, now: number): Promise<void> {
  const due = await redis.zrangebyscore(CALLBACK_DELAY_KEY, 0, now);
  await Promise.all(
    due.slice(0, SIDE_EFFECTS_PER_TICK).map((member) => deliverCallback(redis, now, member)),
  );
}

async function deliverCallback(redis: SendRedis, now: number, member: string): Promise<void> {
  const removed = await redis.zrem(CALLBACK_DELAY_KEY, member);
  if (removed !== 1) {
    return;
  }
  let payload: { id?: unknown; status?: unknown };
  try {
    payload = JSON.parse(member) as { id?: unknown; status?: unknown };
  } catch {
    return;
  }
  if (typeof payload.id !== 'string' || typeof payload.status !== 'string') {
    return;
  }
  const posted = await postMockCallback({ id: payload.id, status: payload.status });
  if (posted) {
    return;
  }
  const base = process.env.API_INTERNAL_URL;
  if (base === undefined || base === '') {
    await redis.zadd(RECEIPT_QUEUE_KEY, now, receiptMember(payload.status, payload.id));
    return;
  }
  await redis.zadd(CALLBACK_DELAY_KEY, now + 1000, member);
}

async function postMockCallback(body: { id: string; status: string }): Promise<boolean> {
  const base = process.env.API_INTERNAL_URL;
  if (base === undefined || base === '') {
    return false;
  }
  try {
    const response = await fetch(new URL('/api/hooks/providers/mock', base), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-signature': MOCK_CALLBACK_SECRET,
      },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function markFailed(
  prisma: PrismaClient,
  message: { id: string; organizationId: string; priceMicros: bigint | null },
  errorCode: string,
): Promise<void> {
  const price = message.priceMicros ?? 0n;
  await prisma.$transaction(async (tx) => {
    if (price > 0n) {
      await settle(tx, message.organizationId, price, message.id, 'RELEASE', 'Send failed');
    }
    const updated = await tx.message.updateMany({
      where: { id: message.id, status: { in: ['QUEUED', 'SENDING'] } },
      data: { status: 'FAILED', errorCode, failedAt: new Date() },
    });
    if (updated.count === 1) {
      await tx.messageEvent.create({
        data: { messageId: message.id, status: 'FAILED', detail: errorCode },
      });
    }
  });
}

async function applyReceipts(prisma: PrismaClient, redis: SendRedis, now: number): Promise<void> {
  const due = await redis.zrangebyscore(RECEIPT_QUEUE_KEY, 0, now);
  for (const member of due.slice(0, SIDE_EFFECTS_PER_TICK)) {
    const removed = await redis.zrem(RECEIPT_QUEUE_KEY, member);
    if (removed !== 1) {
      continue;
    }
    const split = member.indexOf(':');
    if (split <= 0) {
      continue;
    }
    const status = member.slice(0, split).toUpperCase();
    const id = member.slice(split + 1);
    if (status !== 'DELIVERED' && status !== 'UNDELIVERED' && status !== 'EXPIRED') {
      continue;
    }
    const byProvider = await prisma.message.findFirst({ where: { providerMessageId: id } });
    const message =
      byProvider ?? (UUID.test(id) ? await prisma.message.findUnique({ where: { id } }) : null);
    if (message === null) {
      continue;
    }
    const next = transitionMessage(message.status, status);
    if (next === null) {
      continue;
    }
    await prisma.message.update({
      where: { id: message.id },
      data: {
        status: next,
        ...(next === 'DELIVERED' ? { deliveredAt: new Date(now), errorCode: null } : {}),
        ...(next === 'EXPIRED' ? { errorCode: 'expired' } : {}),
        ...(next === 'UNDELIVERED' ? { errorCode: 'carrier_rejected' } : {}),
      },
    });
    await prisma.messageEvent.create({
      data: { messageId: message.id, status: next, detail: 'Delivery receipt.' },
    });
  }
}

async function expireSent(prisma: PrismaClient, now: number): Promise<void> {
  const stale = await prisma.message.findMany({
    where: { status: 'SENT', sentAt: { lt: new Date(now - MESSAGE_VALIDITY_MS) } },
    take: 100,
  });
  for (const message of stale) {
    if (transitionMessage(message.status, 'EXPIRED') === null) {
      continue;
    }
    const updated = await prisma.message.updateMany({
      where: { id: message.id, status: 'SENT' },
      data: { status: 'EXPIRED', errorCode: 'expired' },
    });
    if (updated.count === 1) {
      await prisma.messageEvent.create({
        data: { messageId: message.id, status: 'EXPIRED', detail: 'Validity period elapsed.' },
      });
    }
  }
}

async function requeueStuck(prisma: PrismaClient, redis: SendRedis, now: number): Promise<void> {
  const cutoff = new Date(now - STUCK_MS);
  const [queued, sending] = await Promise.all([
    prisma.message.findMany({
      where: { status: 'QUEUED', queuedAt: { lt: cutoff } },
      take: 50,
    }),
    prisma.message.findMany({
      where: { status: 'SENDING', updatedAt: { lt: cutoff } },
      take: 50,
    }),
  ]);
  for (const message of [...queued, ...sending]) {
    const marked = await redis.set(`smsvio:requeue:${message.id}`, '1', 'EX', 30, 'NX');
    if (marked === 'OK') {
      await redis.lpush(SEND_QUEUE_KEY, message.id);
    }
  }
}

async function settle(
  tx: Tx,
  organizationId: string,
  amount: bigint,
  messageId: string,
  type: 'CHARGE' | 'RELEASE',
  note: string,
): Promise<void> {
  const entries = await tx.ledgerEntry.findMany({
    where: { organizationId, refId: messageId, type: { in: ['HOLD', 'CHARGE', 'RELEASE'] } },
  });
  if (entries.some((entry) => entry.type === 'CHARGE' || entry.type === 'RELEASE')) {
    return;
  }
  const hold = entries.find((entry) => entry.type === 'HOLD');
  if (hold?.amountMicros !== -amount) {
    return;
  }
  const updated =
    type === 'CHARGE'
      ? await tx.orgBalance.updateMany({
          where: { organizationId, heldMicros: { gte: amount } },
          data: { heldMicros: { decrement: amount } },
        })
      : await tx.orgBalance.updateMany({
          where: { organizationId, heldMicros: { gte: amount } },
          data: { heldMicros: { decrement: amount }, availableMicros: { increment: amount } },
        });
  if (updated.count !== 1) {
    return;
  }
  const next = await tx.orgBalance.findUnique({ where: { organizationId } });
  await tx.ledgerEntry.create({
    data: {
      organizationId,
      type,
      amountMicros: type === 'CHARGE' ? -amount : amount,
      balanceAfterMicros: next?.availableMicros ?? 0n,
      refType: 'message',
      refId: messageId,
      note,
    },
  });
}
