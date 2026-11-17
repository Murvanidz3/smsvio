import { randomUUID } from 'node:crypto';

import type { Prisma } from '@smsvio/db';

import { WEBHOOK_QUEUE_KEY } from '@smsvio/shared';

export interface CustomerEventInput {
  readonly organizationId: string;
  readonly type: string;
  readonly data: Prisma.InputJsonValue;
}

interface EndpointRow {
  readonly id: string;
  readonly events: readonly string[];
}

interface EventDb {
  webhookEndpoint?: {
    findMany(args: { where: { organizationId: string; status: 'ACTIVE' } }): Promise<EndpointRow[]>;
  };
  webhookDelivery?: {
    create(args: {
      data: {
        endpointId: string;
        eventId: string;
        eventType: string;
        payload: Prisma.InputJsonValue;
        attempt: number;
        status: 'PENDING';
      };
    }): Promise<{ id: string }>;
  };
}

/** Writes one pending delivery per subscribed endpoint and queues its id. */
export async function publishCustomerEvent(
  prisma: EventDb,
  redis: { lpush(key: string, value: string): Promise<unknown> } | undefined,
  event: CustomerEventInput,
): Promise<void> {
  if (
    redis === undefined ||
    prisma.webhookEndpoint === undefined ||
    prisma.webhookDelivery === undefined
  ) {
    return;
  }
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { organizationId: event.organizationId, status: 'ACTIVE' },
  });
  const createdAt = new Date().toISOString();
  for (const endpoint of endpoints) {
    if (!endpoint.events.includes(event.type)) {
      continue;
    }
    const eventId = `evt_${randomUUID().replaceAll('-', '')}`;
    const delivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventId,
        eventType: event.type,
        payload: { id: eventId, type: event.type, created_at: createdAt, data: event.data },
        attempt: 0,
        status: 'PENDING',
      },
    });
    await redis.lpush(WEBHOOK_QUEUE_KEY, delivery.id);
  }
}
