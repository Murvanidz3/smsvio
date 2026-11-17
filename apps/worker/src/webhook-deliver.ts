import type { PrismaClient } from '@smsvio/db';
import { WEBHOOK_DELAY_KEY, WEBHOOK_QUEUE_KEY, webhookRetryDelayMs } from '@smsvio/shared';
import { signWebhook } from '@smsvio/shared/developer';

import type { SendRedis } from './dispatch.js';

const BATCH = 20;

export interface WebhookTickDeps {
  readonly now: number;
  decrypt(payload: string): string;
  post(
    url: string,
    headers: Readonly<Record<string, string>>,
    body: string,
  ): Promise<{ status: number; durationMs: number }>;
  notify(endpoint: { organizationId: string; name: string; url: string }): Promise<void>;
}

/** Promotes due retries and delivers a batch. A Redis lock keeps one delivery in one worker. */
export async function runWebhookTick(
  prisma: PrismaClient,
  redis: SendRedis,
  deps: WebhookTickDeps,
): Promise<void> {
  await promote(redis, deps.now);
  for (let count = 0; count < BATCH; count += 1) {
    const id = await redis.rpop(WEBHOOK_QUEUE_KEY);
    if (id === null) {
      return;
    }
    await deliverOne(prisma, redis, id, deps);
  }
}

async function promote(redis: SendRedis, now: number): Promise<void> {
  const due = await redis.zrangebyscore(WEBHOOK_DELAY_KEY, 0, now);
  for (const id of due.slice(0, BATCH)) {
    const removed = await redis.zrem(WEBHOOK_DELAY_KEY, id);
    if (removed === 1) {
      await redis.lpush(WEBHOOK_QUEUE_KEY, id);
    }
  }
}

async function deliverOne(
  prisma: PrismaClient,
  redis: SendRedis,
  id: string,
  deps: WebhookTickDeps,
): Promise<void> {
  const locked = await redis.set(`smsvio:wh:${id}`, '1', 'EX', 30, 'NX');
  if (locked !== 'OK') {
    await redis.zadd(WEBHOOK_DELAY_KEY, deps.now + 1000, id);
    return;
  }
  try {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id },
      include: { endpoint: true },
    });
    if (delivery?.status !== 'PENDING') {
      return;
    }
    if (delivery.endpoint.status !== 'ACTIVE') {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', attempt: delivery.attempt + 1 },
      });
      return;
    }
    await attempt(prisma, redis, delivery, deps);
  } finally {
    await redis.del(`smsvio:wh:${id}`);
  }
}

async function attempt(
  prisma: PrismaClient,
  redis: SendRedis,
  delivery: {
    id: string;
    eventId: string;
    attempt: number;
    payload: unknown;
    endpoint: { id: string; organizationId: string; name: string; url: string; secretEnc: string };
  },
  deps: WebhookTickDeps,
): Promise<void> {
  const body = JSON.stringify(delivery.payload);
  let status: number | null = null;
  let durationMs: number | null = null;
  let succeeded = false;
  try {
    const secret = deps.decrypt(delivery.endpoint.secretEnc);
    const timestamp = String(Math.floor(deps.now / 1000));
    const signature = signWebhook(secret, delivery.eventId, timestamp, body);
    const posted = await deps.post(
      delivery.endpoint.url,
      {
        'webhook-id': delivery.eventId,
        'webhook-timestamp': timestamp,
        'webhook-signature': signature,
      },
      body,
    );
    status = posted.status;
    durationMs = posted.durationMs;
    succeeded = posted.status >= 200 && posted.status < 300;
  } catch {
    succeeded = false;
  }
  const nextAttempt = delivery.attempt + 1;
  if (succeeded) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'SUCCEEDED',
        attempt: nextAttempt,
        responseStatus: status,
        responseMs: durationMs,
        nextRetryAt: null,
      },
    });
    await prisma.webhookEndpoint.updateMany({
      where: { id: delivery.endpoint.id, status: 'ACTIVE' },
      data: { consecutiveFailures: 0 },
    });
    return;
  }
  const delay = webhookRetryDelayMs(nextAttempt);
  if (delay === null) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        attempt: nextAttempt,
        responseStatus: status,
        responseMs: durationMs,
        nextRetryAt: null,
      },
    });
    const disabled = await prisma.webhookEndpoint.updateMany({
      where: { id: delivery.endpoint.id, status: 'ACTIVE' },
      data: { status: 'DISABLED', consecutiveFailures: { increment: 1 } },
    });
    if (disabled.count === 1) {
      try {
        await deps.notify(delivery.endpoint);
      } catch {
        // The endpoint stays disabled when mail is unavailable.
      }
    }
    return;
  }
  const nextRetryAt = new Date(deps.now + delay);
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: 'PENDING',
      attempt: nextAttempt,
      responseStatus: status,
      responseMs: durationMs,
      nextRetryAt,
    },
  });
  await prisma.webhookEndpoint.update({
    where: { id: delivery.endpoint.id },
    data: { consecutiveFailures: { increment: 1 } },
  });
  await redis.zadd(WEBHOOK_DELAY_KEY, nextRetryAt.getTime(), delivery.id);
}
