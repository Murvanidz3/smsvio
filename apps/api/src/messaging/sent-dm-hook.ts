import { RECEIPT_QUEUE_KEY, receiptMember } from '@smsvio/shared';
import {
  SENT_DM_RECEIPT_DELAY_MS,
  parseSentDmEvent,
  sentDmReceiptToken,
  verifySentDmWebhook,
} from '@smsvio/shared/provider';

import { ApiError } from '../http/api-error.js';

export interface SentDmHookRedis {
  set(key: string, value: string, expiry: 'EX', seconds: number, mode: 'NX'): Promise<'OK' | null>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** Sent retries one event for about 2.6 hours. A week of dedupe keys covers that with room. */
const DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function sentDmDedupeKey(eventId: string): string {
  return `smsvio:sentdm:webhook:${eventId}`;
}

export type SentDmHookOutcome = 'queued' | 'ignored' | 'duplicate';

/**
 * Verifies one Sent webhook against the raw body and queues its status as a delivery receipt.
 * A repeated webhook-id is acknowledged without queuing again; the receipt state machine also
 * ignores a repeated or backward status, so a replay never moves a message twice.
 */
export async function acceptSentDmWebhook(
  redis: SentDmHookRedis,
  secret: string | undefined,
  raw: {
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly rawBody: string | undefined;
  },
  now = Date.now(),
): Promise<SentDmHookOutcome> {
  if (secret === undefined) {
    throw new ApiError(404, 'not_found', 'Sent webhooks are not configured.');
  }
  if (raw.rawBody === undefined) {
    throw new ApiError(400, 'bad_request', 'The webhook body is missing.');
  }
  const verified = verifySentDmWebhook({
    secret,
    headers: raw.headers,
    rawBody: raw.rawBody,
    nowSeconds: Math.floor(now / 1000),
  });
  if (!verified.ok) {
    throw new ApiError(401, 'unauthorized', 'The Sent signature was rejected.');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw.rawBody) as unknown;
  } catch {
    throw new ApiError(400, 'bad_request', 'The webhook body is not JSON.');
  }
  const event = parseSentDmEvent(body);
  const token = event === null ? null : sentDmReceiptToken(event.status, event.reasonCode);
  if (event === null || token === null) {
    return 'ignored';
  }
  const key = sentDmDedupeKey(verified.eventId);
  const fresh = await redis.set(key, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX');
  if (fresh !== 'OK') {
    return 'duplicate';
  }
  try {
    await redis.zadd(
      RECEIPT_QUEUE_KEY,
      now + SENT_DM_RECEIPT_DELAY_MS,
      receiptMember(token, event.messageId),
    );
  } catch (error) {
    await redis.del(key);
    throw error;
  }
  return 'queued';
}
