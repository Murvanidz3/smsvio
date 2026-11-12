import { createHash, randomUUID } from 'node:crypto';

export type MockReceiptStatus = 'delivered' | 'undelivered' | 'expired';

export interface ProviderSendRequest {
  readonly to: string;
  readonly from: string;
  readonly body: string;
  readonly encoding: string;
  readonly segments: number;
}

export interface ScheduledReceipt {
  readonly status: MockReceiptStatus;
  readonly delayMs: number;
}

export type ProviderSendResult =
  | {
      readonly status: 'accepted';
      readonly providerMessageId: string;
      readonly receipt: ScheduledReceipt;
    }
  | { readonly status: 'temporary_failure'; readonly errorCode: 'carrier_rejected' }
  | { readonly status: 'permanent_failure'; readonly errorCode: 'carrier_rejected' };

export interface RawHttpRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
}

export interface ProviderReceipt {
  readonly providerMessageId: string;
  readonly status: MockReceiptStatus | 'failed';
}

export interface ProviderInbound {
  readonly from: string;
  readonly to: string;
  readonly body: string;
}

export interface ProviderHealth {
  readonly ok: boolean;
  readonly detail: string;
}

/** Well-known signature for the simulated provider. It is not a carrier credential. */
export const MOCK_CALLBACK_SECRET = 'smsvio-mock-callback';

const DELIVERED_DELAY_MS = 1000;
const SLOW_DELAY_MS = 30_000;

/**
 * Last four digits of the destination pick a deterministic result.
 * 1001 delivered, 1002 undelivered, 1003 permanent failure, 1004 expired,
 * 1005 slow delivered, 1006 temporary failure. Anything else is delivered.
 */
export function mockSuffix(to: string): string {
  const digits = to.replace(/\D/g, '');
  return digits.slice(-4);
}

export function hashProviderSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function header(raw: RawHttpRequest, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(raw.headers)) {
    if (key.toLowerCase() === target && value !== undefined && value !== '') {
      return value;
    }
  }
  return undefined;
}

/**
 * Development and test provider. It never contacts a carrier.
 * Delivery is a scheduled result the worker applies later; nothing is sent now.
 */
export class MockProvider {
  readonly code: string;

  constructor(
    private readonly options: {
      readonly code?: string;
      readonly callbackSecretHash: string | null;
      readonly nextId?: () => string;
    },
  ) {
    this.code = options.code ?? 'mock';
  }

  send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    const suffix = mockSuffix(request.to);
    if (suffix === '1003') {
      return Promise.resolve({ status: 'permanent_failure', errorCode: 'carrier_rejected' });
    }
    if (suffix === '1006') {
      return Promise.resolve({ status: 'temporary_failure', errorCode: 'carrier_rejected' });
    }
    const receipt: ScheduledReceipt =
      suffix === '1002'
        ? { status: 'undelivered', delayMs: DELIVERED_DELAY_MS }
        : suffix === '1004'
          ? { status: 'expired', delayMs: DELIVERED_DELAY_MS }
          : suffix === '1005'
            ? { status: 'delivered', delayMs: SLOW_DELAY_MS }
            : { status: 'delivered', delayMs: DELIVERED_DELAY_MS };
    return Promise.resolve({
      status: 'accepted',
      providerMessageId: `mock_${(this.options.nextId ?? randomUUID)()}`,
      receipt,
    });
  }

  verifyCallback(raw: RawHttpRequest): boolean {
    const secret = header(raw, 'x-mock-signature');
    if (secret === undefined || this.options.callbackSecretHash === null) {
      return false;
    }
    return constantTimeEqual(hashProviderSecret(secret), this.options.callbackSecretHash);
  }

  parseDeliveryReceipts(raw: RawHttpRequest): ProviderReceipt[] {
    const body = raw.body;
    if (typeof body !== 'object' || body === null) {
      return [];
    }
    const record = body as Record<string, unknown>;
    const id = record.id;
    const status = record.status;
    if (typeof id !== 'string' || id.length === 0 || id.length > 120) {
      return [];
    }
    if (
      status !== 'delivered' &&
      status !== 'undelivered' &&
      status !== 'expired' &&
      status !== 'failed'
    ) {
      return [];
    }
    return [{ providerMessageId: id, status }];
  }

  parseInbound(raw: RawHttpRequest): ProviderInbound[] {
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

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      ok: true,
      detail: 'Mock provider does not contact a carrier.',
    });
  }
}
