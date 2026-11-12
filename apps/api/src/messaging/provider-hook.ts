import type { PrismaClient } from '@smsvio/db';
import { RECEIPT_QUEUE_KEY, receiptMember } from '@smsvio/shared';
import { MockProvider, type RawHttpRequest } from '@smsvio/shared/provider';

import { ApiError } from '../http/api-error.js';

export interface ReceiptRedis {
  zadd(key: string, score: number, member: string): Promise<unknown>;
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
  if (code !== 'mock') {
    throw new ApiError(404, 'not_found', 'That provider does not exist.');
  }
  const providers = await prisma.provider.findMany({
    where: { code, type: 'MOCK', status: 'ACTIVE' },
  });
  const provider = providers[0];
  if (provider === undefined) {
    throw new ApiError(404, 'not_found', 'That provider does not exist.');
  }
  const mock = new MockProvider({ code, callbackSecretHash: provider.callbackSecretHash });
  if (!mock.verifyCallback(raw)) {
    throw new ApiError(401, 'unauthorized', 'The provider signature was rejected.');
  }
  const receipts = mock.parseDeliveryReceipts(raw);
  for (const receipt of receipts) {
    const status = receipt.status === 'failed' ? 'undelivered' : receipt.status;
    await redis.zadd(RECEIPT_QUEUE_KEY, now, receiptMember(status, receipt.providerMessageId));
  }
  return receipts.length;
}
