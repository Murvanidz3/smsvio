import { z } from 'zod';

import type { ProviderReceipt, ProviderSendResult } from './mock.js';

const receiptStatus = z.enum(['delivered', 'undelivered', 'expired', 'failed']);

export const httpProviderConfigSchema = z.object({
  url: z
    .string()
    .trim()
    .regex(/^https:\/\/[^\s]+$/, 'The provider URL must be https.'),
  headers: z.record(z.string(), z.string()).default({}),
  idField: z.string().trim().min(1).max(40).default('id'),
  acceptedStatuses: z.array(z.number().int().min(100).max(599)).default([200, 201, 202]),
  permanentStatuses: z.array(z.number().int().min(100).max(599)).default([400, 401, 403, 404, 422]),
  receiptMap: z.record(z.string(), receiptStatus).default({
    delivered: 'delivered',
    undelivered: 'undelivered',
    expired: 'expired',
    failed: 'failed',
    DELIVRD: 'delivered',
    UNDELIV: 'undelivered',
    EXPIRED: 'expired',
    REJECTD: 'failed',
  }),
});

export type HttpProviderConfig = z.infer<typeof httpProviderConfigSchema>;

export interface HttpSendResponse {
  readonly status: number;
  readonly body: string;
}

/** Maps one HTTPS response into a send result. The caller performs the request. */
export function interpretHttpSend(
  config: HttpProviderConfig,
  response: HttpSendResponse,
): ProviderSendResult {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(response.body) as unknown;
  } catch {
    parsed = null;
  }
  const record =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  const id = record?.[config.idField];
  if (
    config.acceptedStatuses.includes(response.status) &&
    typeof id === 'string' &&
    id.length > 0
  ) {
    return { status: 'accepted', providerMessageId: id };
  }
  if (config.permanentStatuses.includes(response.status)) {
    return { status: 'permanent_failure', errorCode: 'carrier_rejected' };
  }
  return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
}

export function interpretHttpReceipt(
  config: HttpProviderConfig,
  body: unknown,
): ProviderReceipt | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const id = record.id;
  const status = record.status;
  if (typeof id !== 'string' || id.length === 0 || typeof status !== 'string') {
    return null;
  }
  const mapped = config.receiptMap[status];
  if (mapped === undefined) {
    return null;
  }
  return { providerMessageId: id, status: mapped === 'failed' ? 'failed' : mapped };
}
