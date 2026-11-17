import type { PrismaClient } from '@smsvio/db';
import { applyInbound, attributeInbound } from '@smsvio/server';
import { RECEIPT_QUEUE_KEY, receiptMember } from '@smsvio/shared';
import { decryptString } from '@smsvio/shared/developer';
import {
  MockProvider,
  httpProviderConfigSchema,
  interpretHttpReceipt,
  type ProviderInbound,
  type ProviderReceipt,
  type RawHttpRequest,
} from '@smsvio/shared/provider';

import { ApiError } from '../http/api-error.js';

export interface ReceiptRedis {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  lpush?(key: string, value: string): Promise<unknown>;
}

/**
 * Verifies a provider callback and queues each receipt.
 * A repeated receipt is the same sorted-set member, and the state machine ignores it.
 */
export async function acceptProviderCallback(
  prisma: PrismaClient,
  redis: ReceiptRedis,
  code: string,
  raw: RawHttpRequest,
  now = Date.now(),
): Promise<number> {
  const providers = await prisma.provider.findMany({ where: { code, status: 'ACTIVE' } });
  const provider = providers[0];
  if (provider === undefined) {
    throw new ApiError(404, 'not_found', 'That provider does not exist.');
  }
  if (provider.type === 'MOCK') {
    const mock = new MockProvider({ code, callbackSecretHash: provider.callbackSecretHash });
    if (!mock.verifyCallback(raw)) {
      throw new ApiError(401, 'unauthorized', 'The provider signature was rejected.');
    }
    await storeInbound(prisma, redis, mock.parseInbound(raw));
    return queueReceipts(redis, mock.parseDeliveryReceipts(raw), now);
  }
  if (provider.type !== 'HTTP') {
    throw new ApiError(404, 'not_found', 'That provider does not accept HTTP callbacks.');
  }
  if (!signed(raw, provider.callbackSecretHash)) {
    throw new ApiError(401, 'unauthorized', 'The provider signature was rejected.');
  }
  const config = readHttpConfig(provider.configEnc);
  const receipt = interpretHttpReceipt(config, raw.body);
  await storeInbound(prisma, redis, readInbound(raw));
  return queueReceipts(redis, receipt === null ? [] : [receipt], now);
}

function signed(raw: RawHttpRequest, hash: string | null): boolean {
  const mock = new MockProvider({ callbackSecretHash: hash });
  const secret = header(raw, 'x-smsvio-signature');
  return mock.verifyCallback({
    headers: { 'x-mock-signature': secret },
    body: raw.body,
  });
}

function header(raw: RawHttpRequest, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(raw.headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function readHttpConfig(configEnc: string | null) {
  const fallback = httpProviderConfigSchema.parse({ url: 'https://provider.invalid/sms' });
  if (configEnc === null || process.env.APP_ENCRYPTION_KEY === undefined) {
    return fallback;
  }
  try {
    const parsed = httpProviderConfigSchema.safeParse(
      JSON.parse(decryptString(configEnc, process.env.APP_ENCRYPTION_KEY)),
    );
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function readInbound(raw: RawHttpRequest): ProviderInbound[] {
  const body = raw.body;
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.from !== 'string' ||
    typeof record.to !== 'string' ||
    typeof record.body !== 'string'
  ) {
    return [];
  }
  return [{ from: record.from, to: record.to, body: record.body }];
}

async function queueReceipts(
  redis: ReceiptRedis,
  receipts: ProviderReceipt[],
  now: number,
): Promise<number> {
  for (const receipt of receipts) {
    const status = receipt.status === 'failed' ? 'undelivered' : receipt.status;
    await redis.zadd(RECEIPT_QUEUE_KEY, now, receiptMember(status, receipt.providerMessageId));
  }
  return receipts.length;
}

async function storeInbound(
  prisma: PrismaClient,
  redis: ReceiptRedis,
  inbound: ProviderInbound[],
): Promise<void> {
  if (redis.lpush === undefined) {
    return;
  }
  for (const item of inbound) {
    const from = item.from.startsWith('+') ? item.from : `+${item.from.replace(/\D/g, '')}`;
    const organizationId = await attributeInbound(prisma, from);
    if (organizationId === null) {
      continue;
    }
    await applyInbound(prisma, { lpush: redis.lpush.bind(redis) }, organizationId, {
      from,
      to: item.to,
      body: item.body,
    });
  }
}
