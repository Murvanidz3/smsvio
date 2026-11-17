import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@smsvio/db';
import { WEBHOOK_QUEUE_KEY } from '@smsvio/shared';
import { createWebhookSecret } from '@smsvio/shared/developer';
import { PRISMA, REDIS } from '@smsvio/server';
import type { Redis } from 'ioredis';

import type { AuthState } from '../accounts/support.js';
import { assertCapability, writeAudit } from '../accounts/support.js';
import type { ClientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { decryptString, encryptString } from '../security/encryption.js';
import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';

interface Page {
  readonly page: number;
  readonly pageSize: number;
}

interface EndpointInput {
  readonly name: string;
  readonly url: string;
  readonly events: readonly string[];
}

@Injectable()
export class WebhookService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Optional() @Inject(REDIS) private readonly redis?: Redis,
  ) {}

  async list(state: AuthState, query: Page) {
    assertCapability(state, 'developer');
    const where = { organizationId: state.organizationId };
    const [total, rows] = await Promise.all([
      this.prisma.webhookEndpoint.count({ where }),
      this.prisma.webhookEndpoint.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items: rows.map(presentEndpoint) };
  }

  async create(state: AuthState, input: EndpointInput, client: ClientInfo) {
    assertCapability(state, 'developer');
    const secret = createWebhookSecret();
    const row = await this.prisma.webhookEndpoint.create({
      data: {
        organizationId: state.organizationId,
        name: input.name,
        url: input.url,
        events: [...input.events],
        secretEnc: encryptString(secret, this.env.APP_ENCRYPTION_KEY),
      },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'webhook.created',
      targetType: 'webhook_endpoint',
      targetId: row.id,
      ip: client.ip,
      meta: { name: row.name },
    });
    return { ...presentEndpoint(row), secret };
  }

  async get(state: AuthState, id: string, query: Page) {
    assertCapability(state, 'developer');
    const endpoint = await this.find(state.organizationId, id);
    const where = { endpointId: endpoint.id };
    const [total, rows] = await Promise.all([
      this.prisma.webhookDelivery.count({ where }),
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      ...presentEndpoint(endpoint),
      deliveries: {
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: rows.map(presentDelivery),
      },
    };
  }

  async update(
    state: AuthState,
    id: string,
    input: Partial<EndpointInput> & { status?: 'ACTIVE' | 'DISABLED' },
    client: ClientInfo,
  ) {
    assertCapability(state, 'developer');
    await this.find(state.organizationId, id);
    const row = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.events === undefined ? {} : { events: [...input.events] }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.status === 'ACTIVE' ? { consecutiveFailures: 0 } : {}),
      },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'webhook.updated',
      targetType: 'webhook_endpoint',
      targetId: row.id,
      ip: client.ip,
      meta: { status: row.status },
    });
    return presentEndpoint(row);
  }

  async remove(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'developer');
    await this.find(state.organizationId, id);
    await this.prisma.webhookDelivery.deleteMany({ where: { endpointId: id } });
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'webhook.deleted',
      targetType: 'webhook_endpoint',
      targetId: id,
      ip: client.ip,
    });
    return { message: 'Webhook deleted.' };
  }

  async reveal(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'developer');
    const endpoint = await this.find(state.organizationId, id);
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'webhook.secret_revealed',
      targetType: 'webhook_endpoint',
      targetId: id,
      ip: client.ip,
    });
    return { secret: decryptString(endpoint.secretEnc, this.env.APP_ENCRYPTION_KEY) };
  }

  async rotate(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'developer');
    await this.find(state.organizationId, id);
    const secret = createWebhookSecret();
    await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { secretEnc: encryptString(secret, this.env.APP_ENCRYPTION_KEY) },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'webhook.secret_rotated',
      targetType: 'webhook_endpoint',
      targetId: id,
      ip: client.ip,
    });
    return { secret };
  }

  async sendTest(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'developer');
    const endpoint = await this.requireActive(state.organizationId, id);
    const deliveryId = await this.enqueue(endpoint.id, 'webhook.test', {
      endpoint_id: endpoint.id,
      message: 'SMSVIO webhook test',
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'webhook.test',
      targetType: 'webhook_endpoint',
      targetId: id,
      ip: client.ip,
    });
    return { deliveryId, message: 'Test event queued.' };
  }

  async replay(state: AuthState, id: string, deliveryId: string, client: ClientInfo) {
    assertCapability(state, 'developer');
    const endpoint = await this.requireActive(state.organizationId, id);
    const prior = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (prior?.endpointId !== endpoint.id) {
      throw new ApiError(404, 'not_found', 'That delivery does not exist.');
    }
    const eventId = newEventId();
    const payload = replayPayload(prior.payload, eventId, prior.eventId);
    const created = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventId,
        eventType: prior.eventType,
        payload,
        status: 'PENDING',
        attempt: 0,
      },
    });
    await this.queue(created.id);
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'webhook.replayed',
      targetType: 'webhook_delivery',
      targetId: created.id,
      ip: client.ip,
      meta: { source: prior.id },
    });
    return { deliveryId: created.id, message: 'Delivery queued again.' };
  }

  private async enqueue(
    endpointId: string,
    type: string,
    data: Prisma.InputJsonObject,
  ): Promise<string> {
    const eventId = newEventId();
    const created = await this.prisma.webhookDelivery.create({
      data: {
        endpointId,
        eventId,
        eventType: type,
        payload: { id: eventId, type, created_at: new Date().toISOString(), data },
        status: 'PENDING',
        attempt: 0,
      },
    });
    await this.queue(created.id);
    return created.id;
  }

  private async queue(id: string): Promise<void> {
    if (this.redis === undefined) {
      throw new ApiError(503, 'internal_error', 'The delivery queue is unavailable.');
    }
    await this.redis.lpush(WEBHOOK_QUEUE_KEY, id);
  }

  private async requireActive(organizationId: string, id: string) {
    const endpoint = await this.find(organizationId, id);
    if (endpoint.status !== 'ACTIVE') {
      throw new ApiError(409, 'conflict', 'Enable the webhook before sending to it.');
    }
    return endpoint;
  }

  private async find(organizationId: string, id: string) {
    const row = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (row?.organizationId !== organizationId) {
      throw new ApiError(404, 'not_found', 'That webhook does not exist.');
    }
    return row;
  }
}

function newEventId(): string {
  return `evt_${randomUUID().replaceAll('-', '')}`;
}

function presentEndpoint(row: {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: 'ACTIVE' | 'DISABLED';
  consecutiveFailures: number;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    createdAt: row.createdAt.toISOString(),
  };
}

function presentDelivery(row: {
  id: string;
  eventId: string;
  eventType: string;
  attempt: number;
  responseStatus: number | null;
  responseMs: number | null;
  status: string;
  nextRetryAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    attempt: row.attempt,
    responseStatus: row.responseStatus,
    responseMs: row.responseMs,
    status: row.status,
    nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function replayPayload(
  payload: Prisma.JsonValue,
  eventId: string,
  source: string,
): Prisma.InputJsonObject {
  const base =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload : {};
  return { ...base, id: eventId, replayed_from: source };
}
