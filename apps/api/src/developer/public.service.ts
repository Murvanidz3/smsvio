import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import {
  RATE_LIMITS,
  decodeCursor,
  encodeCursor,
  problemDetails,
  type ProblemBody,
} from '@smsvio/shared';
import { lookupPhone } from '@smsvio/shared/phone';
import { PRISMA, REDIS } from '@smsvio/server';
import type { Redis } from 'ioredis';

import type { AuthState } from '../accounts/support.js';
import { assertCapability } from '../accounts/support.js';
import { ContactService } from '../catalog/contacts.service.js';
import { ApiError } from '../http/api-error.js';
import type { ClientInfo } from '../http/client.js';
import { presentMoney } from '../messaging/present.js';
import { PricingService } from '../messaging/pricing.service.js';
import { SendService } from '../messaging/send.service.js';
import { SenderService } from '../messaging/senders.service.js';
import { RateLimiter } from '../security/rate-limit.js';
import { batchIdempotencyKey } from './api-key.guard.js';
import { WebhookService } from './webhooks.service.js';

interface CursorQuery {
  readonly limit: number;
  readonly cursor?: string;
}

interface PublicSend {
  readonly to: string;
  readonly from?: string;
  readonly text?: string;
  readonly template_id?: string;
  readonly variables?: Readonly<Record<string, string>>;
  readonly client_ref?: string;
  readonly scheduled_at?: string;
}

@Injectable()
export class PublicService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly send: SendService,
    private readonly contacts: ContactService,
    private readonly pricing: PricingService,
    private readonly senders: SenderService,
    private readonly webhooks: WebhookService,
    private readonly limits: RateLimiter,
    @Optional() @Inject(REDIS) private readonly redis?: Redis,
  ) {}

  async sendMessage(
    state: AuthState,
    input: PublicSend,
    apiKey: { id: string; mode: 'LIVE' | 'TEST' },
  ) {
    const accepted = await this.send.send(state, toSendInput(input), {
      apiKeyId: apiKey.id,
      billable: apiKey.mode === 'LIVE',
    });
    return {
      id: accepted.id,
      status: accepted.status,
      to: accepted.to,
      from: accepted.from,
      segments: accepted.segments,
      encoding: accepted.encoding,
      price: accepted.price,
    };
  }

  async sendBatch(
    state: AuthState,
    messages: readonly PublicSend[],
    idempotencyKey: string | undefined,
    apiKey: { id: string; mode: 'LIVE' | 'TEST' },
  ) {
    assertCapability(state, 'messaging');
    if (idempotencyKey !== undefined && this.redis !== undefined) {
      const cached = await this.redis.get(
        batchIdempotencyKey(state.organizationId, idempotencyKey),
      );
      if (cached !== null) {
        return JSON.parse(cached) as { results: unknown[] };
      }
    }
    const results: ({ index: number } & Record<string, unknown>)[] = [];
    for (const [index, message] of messages.entries()) {
      try {
        const accepted = await this.sendMessage(state, message, apiKey);
        results.push({ index, ...accepted });
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        results.push({
          index,
          error: problemDetails({
            status: error.status,
            code: error.code,
            detail: error.message,
            instance: '/api/v1/messages/batch',
            ...(error.fields === undefined ? {} : { errors: error.fields }),
          }) satisfies ProblemBody,
        });
      }
    }
    const body = { results };
    if (idempotencyKey !== undefined && this.redis !== undefined) {
      await this.redis.set(
        batchIdempotencyKey(state.organizationId, idempotencyKey),
        JSON.stringify(body),
        'EX',
        24 * 60 * 60,
      );
    }
    return body;
  }

  async getMessage(state: AuthState, id: string) {
    assertCapability(state, 'view');
    const row = await this.prisma.message.findFirst({
      where: { id, organizationId: state.organizationId },
    });
    if (row === null) {
      throw new ApiError(404, 'not_found', 'That message does not exist.');
    }
    return presentMessage(row);
  }

  async listMessages(
    state: AuthState,
    query: CursorQuery & { status?: string; to?: string; client_ref?: string },
  ) {
    assertCapability(state, 'view');
    return paginate(query, (where) =>
      this.prisma.message.findMany({
        where: {
          organizationId: state.organizationId,
          ...(query.status === undefined ? {} : { status: query.status.toUpperCase() as 'QUEUED' }),
          ...(query.to === undefined ? {} : { to: query.to }),
          ...(query.client_ref === undefined ? {} : { clientRef: query.client_ref }),
          ...where,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    ).then((page) => ({ ...page, items: page.items.map(presentMessage) }));
  }

  async listContacts(state: AuthState, query: CursorQuery) {
    assertCapability(state, 'view');
    const page = await paginate(query, (where) =>
      this.prisma.contact.findMany({
        where: { organizationId: state.organizationId, ...where },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    return { ...page, items: page.items.map(presentContact) };
  }

  async createContact(
    state: AuthState,
    input: { phone: string; country?: string; name?: string; attributes?: Record<string, string> },
    client: ClientInfo,
  ) {
    const created = await this.contacts.create(state, input, client);
    return presentFromDashboardContact(created);
  }

  async getContact(state: AuthState, id: string) {
    const contact = await this.contacts.get(state, id);
    return presentFromDashboardContact(contact);
  }

  async updateContact(
    state: AuthState,
    id: string,
    input: { name?: string | null; attributes?: Record<string, string>; opted_out?: boolean },
    client: ClientInfo,
  ) {
    return presentFromDashboardContact(await this.contacts.update(state, id, input, client));
  }

  async deleteContact(state: AuthState, id: string, client: ClientInfo) {
    await this.contacts.remove(state, id, client);
    return { id, deleted: true };
  }

  async listTemplates(state: AuthState, query: CursorQuery) {
    assertCapability(state, 'view');
    const page = await paginate(query, (where) =>
      this.prisma.template.findMany({
        where: { organizationId: state.organizationId, ...where },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    return { ...page, items: page.items.map(presentTemplate) };
  }

  async getTemplate(state: AuthState, id: string) {
    assertCapability(state, 'view');
    const row = await this.prisma.template.findFirst({
      where: { id, organizationId: state.organizationId },
    });
    if (row === null) {
      throw new ApiError(404, 'not_found', 'That template does not exist.');
    }
    return presentTemplate(row);
  }

  async sendersView(state: AuthState) {
    const overview = await this.senders.overview(state);
    return {
      senders: overview.senderIds
        .filter((sender) => sender.status === 'APPROVED')
        .map((sender) => ({
          id: sender.id,
          type: sender.type,
          value: sender.value,
          countries: sender.countries,
        })),
      countries: overview.destinations
        .filter((destination) => destination.enabled)
        .map((destination) => ({
          country: destination.iso2,
          name: destination.name,
          sender: destination.sender?.value ?? null,
        })),
      platform_sender: overview.platformSender?.value ?? null,
    };
  }

  async balance(state: AuthState) {
    assertCapability(state, 'view');
    const row = await this.prisma.orgBalance.findUnique({
      where: { organizationId: state.organizationId },
    });
    return {
      currency: 'USD',
      available: presentMoney(row?.availableMicros ?? 0n, 2),
      held: presentMoney(row?.heldMicros ?? 0n, 2),
    };
  }

  async rates(state: AuthState) {
    assertCapability(state, 'view');
    const [prices, countries] = await Promise.all([
      this.pricing.quoteMap(state.organizationId),
      this.prisma.country.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      items: countries.flatMap((country) => {
        const quote = prices.get(country.iso2);
        if (quote === undefined) {
          return [];
        }
        return [
          {
            country: country.iso2,
            name: country.name,
            price: presentMoney(quote.micros, 4),
          },
        ];
      }),
    };
  }

  async lookup(state: AuthState, apiKeyId: string, input: { phone: string; country?: string }) {
    assertCapability(state, 'view');
    await this.limits.enforce(
      `lookup:key:${apiKeyId}`,
      RATE_LIMITS.lookupUser.limit,
      RATE_LIMITS.lookupUser.windowMs,
    );
    const result = lookupPhone(input.phone, input.country);
    return {
      valid: result.valid,
      e164: result.e164,
      international: result.international,
      national: result.national,
      country_code: result.countryCode,
      country_name: result.countryName,
      dial_code: result.dialCode,
      type: result.type,
      region: result.region,
      time_zones: result.timeZones,
    };
  }

  async listWebhooks(state: AuthState, query: CursorQuery) {
    assertCapability(state, 'developer');
    const page = await paginate(query, (where) =>
      this.prisma.webhookEndpoint.findMany({
        where: { organizationId: state.organizationId, ...where },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    return { ...page, items: page.items.map(presentPublicWebhook) };
  }

  async createWebhook(
    state: AuthState,
    input: { name: string; url: string; events: readonly string[] },
    client: ClientInfo,
  ) {
    const created = await this.webhooks.create(state, input, client);
    return { ...presentPublicWebhook(created), secret: created.secret };
  }

  async getWebhook(state: AuthState, id: string) {
    assertCapability(state, 'developer');
    const row = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (row?.organizationId !== state.organizationId) {
      throw new ApiError(404, 'not_found', 'That webhook does not exist.');
    }
    return presentPublicWebhook(row);
  }

  async updateWebhook(
    state: AuthState,
    id: string,
    input: {
      name?: string;
      url?: string;
      events?: readonly string[];
      status?: 'ACTIVE' | 'DISABLED';
    },
    client: ClientInfo,
  ) {
    return presentPublicWebhook(await this.webhooks.update(state, id, input, client));
  }

  async deleteWebhook(state: AuthState, id: string, client: ClientInfo) {
    await this.webhooks.remove(state, id, client);
    return { id, deleted: true };
  }
}

function toSendInput(input: PublicSend) {
  return {
    to: input.to,
    from: input.from,
    text: input.text,
    templateId: input.template_id,
    variables: input.variables,
    clientRef: input.client_ref,
    scheduledAt: input.scheduled_at === undefined ? undefined : new Date(input.scheduled_at),
  };
}

async function paginate<T extends { id: string; createdAt: Date }>(
  query: CursorQuery,
  load: (where: Record<string, unknown>) => Promise<T[]>,
) {
  const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
  if (query.cursor !== undefined && cursor === null) {
    throw new ApiError(400, 'validation_error', 'That cursor is not valid.', {
      cursor: 'Use the next_cursor from a previous page.',
    });
  }
  const where =
    cursor === null
      ? {}
      : {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        };
  const rows = await load(where);
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  const next =
    rows.length > query.limit && last !== undefined ? encodeCursor(last.createdAt, last.id) : null;
  return { items, next_cursor: next };
}

function presentMessage(row: {
  id: string;
  to: string;
  fromSender: string;
  body: string;
  status: string;
  encoding: string;
  segments: number;
  countryIso2: string | null;
  priceMicros: bigint | null;
  clientRef: string | null;
  errorCode: string | null;
  templateId: string | null;
  scheduledAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    to: row.to,
    from: row.fromSender,
    text: row.body,
    status: row.status.toLowerCase(),
    encoding: row.encoding,
    segments: row.segments,
    country: row.countryIso2,
    price: presentMoney(row.priceMicros ?? 0n, 4),
    client_ref: row.clientRef,
    error_code: row.errorCode,
    template_id: row.templateId,
    scheduled_at: row.scheduledAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function presentContact(row: {
  id: string;
  phoneE164: string;
  countryCode: string;
  name: string | null;
  optedOut: boolean;
  attributes: unknown;
  createdAt: Date;
}) {
  return {
    id: row.id,
    phone: row.phoneE164,
    country: row.countryCode,
    name: row.name,
    opted_out: row.optedOut,
    attributes: recordOfStrings(row.attributes),
    created_at: row.createdAt.toISOString(),
  };
}

function presentFromDashboardContact(contact: {
  id: string;
  phoneE164: string;
  countryCode: string;
  name: string | null;
  optedOut: boolean;
  attributes: Record<string, string>;
  createdAt: string;
}) {
  return {
    id: contact.id,
    phone: contact.phoneE164,
    country: contact.countryCode,
    name: contact.name,
    opted_out: contact.optedOut,
    attributes: contact.attributes,
    created_at: contact.createdAt,
  };
}

function presentPublicWebhook(row: {
  id: string;
  name: string;
  url: string;
  events: readonly string[];
  status: 'ACTIVE' | 'DISABLED';
  consecutiveFailures: number;
  createdAt: Date | string;
}) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events,
    status: row.status,
    consecutive_failures: row.consecutiveFailures,
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

function presentTemplate(row: {
  id: string;
  name: string;
  category: string;
  language: string;
  body: string;
  status: string;
  variables: unknown;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    language: row.language,
    body: row.body,
    status: row.status,
    variables: recordOfStrings(row.variables),
    created_at: row.createdAt.toISOString(),
  };
}

function recordOfStrings(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      result[key] = item;
    }
  }
  return result;
}
