export const MESSAGE_STATES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'UNDELIVERED',
  'EXPIRED',
  'FAILED',
  'REJECTED',
] as const;

export type MessageState = (typeof MESSAGE_STATES)[number];

/** A message still `sent` after this long is expired. A later delivered receipt can correct it. */
export const MESSAGE_VALIDITY_MS = 72 * 60 * 60 * 1000;

export const SEND_ATTEMPTS_PER_ROUTE = 3;

/** Dashboard and internal accepts share this per-organization ceiling. */
export const ORG_SENDS_PER_SECOND = 20;

const FORWARD: Record<MessageState, readonly MessageState[]> = {
  QUEUED: ['SENDING', 'FAILED'],
  SENDING: ['SENT', 'FAILED'],
  SENT: ['DELIVERED', 'UNDELIVERED', 'EXPIRED'],
  EXPIRED: ['DELIVERED'],
  DELIVERED: [],
  UNDELIVERED: [],
  FAILED: [],
  REJECTED: [],
};

/**
 * The next status, or null when the transition is a duplicate or is not allowed.
 * The one correction is `delivered` after `expired`.
 */
export function transitionMessage(current: MessageState, next: MessageState): MessageState | null {
  if (current === next || !FORWARD[current].includes(next)) {
    return null;
  }
  return next;
}

/** Exponential backoff in milliseconds, plus up to 250 ms of jitter. */
export function retryDelayMs(attempt: number, random = Math.random()): number {
  const step = Math.max(0, attempt - 1);
  return 1000 * 2 ** step + Math.floor(random * 250);
}

export function spendAllowed(spent: bigint, price: bigint, cap: bigint): boolean {
  return spent + price <= cap;
}

export const SEND_QUEUE_KEY = 'smsvio:q:sms.send';
export const SEND_DELAY_KEY = 'smsvio:q:sms.send:delay';
export const RECEIPT_QUEUE_KEY = 'smsvio:q:sms.dlr';
export const CALLBACK_DELAY_KEY = 'smsvio:q:sms.dlr:callback';

/** A repeated Idempotency-Key or clientRef returns the original message for this long. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function sendLockKey(messageId: string): string {
  return `smsvio:lock:send:${messageId}`;
}

/** Queue member for one delivery receipt. The id is the provider's message id. */
export function receiptMember(status: string, providerMessageId: string): string {
  return `${status}:${providerMessageId}`;
}
