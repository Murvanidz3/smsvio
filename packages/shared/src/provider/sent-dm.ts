import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { SENT_DM_DEFAULT_BASE_URL, sentDmEnvFields } from '../env.js';
import type { ProviderErrorCode, ProviderSendResult } from './mock.js';

/**
 * Sent.dm v3 client (https://docs.sent.dm). Plain fetch, no SDK: the lockfile stays untouched.
 * Sent only sends approved templates, so every send names a Sent template id.
 */

export const SENT_DM_CHANNELS = ['sms', 'whatsapp', 'rcs', 'mms'] as const;
export type SentDmChannel = (typeof SENT_DM_CHANNELS)[number];

/** Every `message_status` Sent reports on GET /v3/messages/{id} and on message webhooks. */
export const SENT_DM_STATUSES = [
  'QUEUED',
  'ROUTED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SCHEDULED',
  'CANCELLED',
  'FILTERED',
  'BLOCKED',
] as const;
export type SentDmStatus = (typeof SENT_DM_STATUSES)[number];

/** Replay window for webhook timestamps, as the Sent docs recommend. */
export const SENT_DM_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/** Sent receipts wait this long in the receipt queue so the worker has stored the message id. */
export const SENT_DM_RECEIPT_DELAY_MS = 5_000;

const E164 = /^\+[1-9]\d{6,14}$/;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Encrypted admin config of a SENT_DM provider row. Maps SMSVIO template ids to Sent template ids. */
export const sentDmProviderConfigSchema = z.object({
  templates: z.record(z.string().trim().min(1), z.string().trim().min(1).max(100)).default({}),
  channel: z.array(z.enum(SENT_DM_CHANNELS)).min(1).max(4).default(['sms']),
});
export type SentDmProviderConfig = z.infer<typeof sentDmProviderConfigSchema>;

export interface SentDmSettings {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly sandbox: boolean;
}

const sentDmEnvSchema = z.object(sentDmEnvFields);

/** Null when SENT_DM_API_KEY is empty: Sent is off and nothing is contacted. */
export function sentDmSettingsFromEnv(
  source: Readonly<Record<string, string | undefined>>,
): SentDmSettings | null {
  const parsed = sentDmEnvSchema.safeParse(source);
  if (!parsed.success || parsed.data.SENT_DM_API_KEY === undefined) {
    return null;
  }
  return {
    apiKey: parsed.data.SENT_DM_API_KEY,
    baseUrl: parsed.data.SENT_DM_BASE_URL,
    sandbox: parsed.data.SENT_DM_SANDBOX,
  };
}

export interface SentDmFetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type SentDmFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<SentDmFetchResponse>;

export interface SentDmSendInput {
  readonly to: readonly string[];
  readonly templateId: string;
  readonly variables?: Readonly<Record<string, string>>;
  readonly channel?: readonly SentDmChannel[];
  /** Reused on every retry so Sent does not send twice. 1-255 of [A-Za-z0-9_-]. */
  readonly idempotencyKey?: string;
}

export interface SentDmRecipient {
  readonly messageId: string;
  readonly to: string;
  readonly channel: string;
}

export interface SentDmSendData {
  readonly status: string;
  readonly templateId: string | null;
  readonly recipients: readonly SentDmRecipient[];
}

export interface SentDmMessageEvent {
  readonly status: string;
  readonly timestamp: string;
  readonly reasonCode: string | null;
}

export interface SentDmMessage {
  readonly id: string;
  readonly phone: string | null;
  readonly templateId: string | null;
  readonly channel: string | null;
  readonly status: SentDmStatus | null;
  readonly createdAt: string | null;
  readonly price: number | null;
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly events: readonly SentDmMessageEvent[];
}

export type SentDmErrorKind =
  'auth' | 'invalid_request' | 'not_found' | 'rate_limited' | 'server' | 'network' | 'unexpected';

export interface SentDmError {
  readonly kind: SentDmErrorKind;
  readonly httpStatus: number | null;
  /** Sent error code such as AUTH_002 or VALIDATION_002. */
  readonly code: string | null;
  readonly message: string;
  readonly requestId: string | null;
  readonly retryable: boolean;
  /** SMSVIO error code stored on the message. */
  readonly smsError: ProviderErrorCode;
}

export type SentDmResult<T> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly requestId: string | null;
      readonly sandbox: boolean;
    }
  | { readonly ok: false; readonly error: SentDmError };

interface Envelope {
  readonly success: boolean | null;
  readonly data: Record<string, unknown> | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly errorDetails: Record<string, unknown> | null;
  readonly requestId: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readEnvelope(body: string): Envelope {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    parsed = null;
  }
  const root = record(parsed);
  const error = record(root?.error);
  const meta = record(root?.meta);
  return {
    success: typeof root?.success === 'boolean' ? root.success : null,
    data: record(root?.data),
    errorCode: text(error?.code),
    errorMessage: text(error?.message),
    errorDetails: record(error?.details),
    requestId: text(meta?.request_id),
  };
}

/** Maps a non-2xx Sent response to our error. 401 is a bad key; 400 a bad template or number. */
export function mapSentDmError(httpStatus: number, body: string): SentDmError {
  const envelope = readEnvelope(body);
  const base = {
    httpStatus,
    code: envelope.errorCode,
    message: envelope.errorMessage ?? `Sent returned HTTP ${String(httpStatus)}.`,
    requestId: envelope.requestId,
  };
  if (httpStatus === 401 || httpStatus === 403) {
    return { ...base, kind: 'auth', retryable: false, smsError: 'provider_auth_failed' };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    return {
      ...base,
      kind: 'invalid_request',
      retryable: false,
      smsError: badRequestCode(envelope),
    };
  }
  if (httpStatus === 404) {
    return { ...base, kind: 'not_found', retryable: false, smsError: 'template_not_approved' };
  }
  if (httpStatus === 429) {
    return { ...base, kind: 'rate_limited', retryable: true, smsError: 'rate_limited' };
  }
  if (httpStatus >= 500) {
    return { ...base, kind: 'server', retryable: true, smsError: 'carrier_rejected' };
  }
  return { ...base, kind: 'unexpected', retryable: false, smsError: 'carrier_rejected' };
}

function badRequestCode(envelope: Envelope): ProviderErrorCode {
  if (envelope.errorCode === 'VALIDATION_002') {
    return 'invalid_number';
  }
  const fields = Object.keys(envelope.errorDetails ?? {}).map((key) => key.toLowerCase());
  if (fields.some((key) => key === 'to' || key.startsWith('to[') || key.includes('phone'))) {
    return 'invalid_number';
  }
  return 'template_not_approved';
}

function localError(message: string, smsError: ProviderErrorCode): SentDmError {
  return {
    kind: 'invalid_request',
    httpStatus: null,
    code: null,
    message,
    requestId: null,
    retryable: false,
    smsError,
  };
}

export function isSentDmStatus(value: unknown): value is SentDmStatus {
  return typeof value === 'string' && (SENT_DM_STATUSES as readonly string[]).includes(value);
}

export class SentDmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly sandbox: boolean;
  private readonly fetchImpl: SentDmFetch;
  private readonly timeoutMs: number;

  constructor(options: {
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly sandbox?: boolean;
    readonly fetch?: SentDmFetch;
    readonly timeoutMs?: number;
  }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? SENT_DM_DEFAULT_BASE_URL;
    this.sandbox = options.sandbox ?? false;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** POST /v3/messages. Numbers must already be E.164. */
  async sendMessage(input: SentDmSendInput): Promise<SentDmResult<SentDmSendData>> {
    if (input.to.length === 0 || input.to.some((to) => !E164.test(to))) {
      return { ok: false, error: localError('Every recipient must be E.164.', 'invalid_number') };
    }
    if (input.templateId.trim() === '') {
      return {
        ok: false,
        error: localError('A Sent template id is required.', 'template_not_approved'),
      };
    }
    const body: Record<string, unknown> = {
      to: [...input.to],
      template: {
        id: input.templateId,
        ...(input.variables === undefined ? {} : { parameters: { ...input.variables } }),
      },
      channel: [...(input.channel ?? ['sms'])],
    };
    if (this.sandbox) {
      body.sandbox = true;
    }
    const headers: Record<string, string> = {};
    if (input.idempotencyKey !== undefined && /^[A-Za-z0-9_-]{1,255}$/.test(input.idempotencyKey)) {
      headers['Idempotency-Key'] = input.idempotencyKey;
    }
    const response = await this.request('POST', '/v3/messages', headers, JSON.stringify(body));
    if (!response.ok) {
      return response;
    }
    const data = response.data;
    const recipients: SentDmRecipient[] = [];
    for (const item of Array.isArray(data.recipients) ? data.recipients : []) {
      const row = record(item);
      const messageId = text(row?.message_id);
      if (messageId !== null) {
        recipients.push({
          messageId,
          to: text(row?.to) ?? '',
          channel: text(row?.channel) ?? '',
        });
      }
    }
    return {
      ...response,
      data: {
        status: text(data.status) ?? 'QUEUED',
        templateId: text(data.template_id),
        recipients,
      },
    };
  }

  /** GET /v3/messages/{id}. */
  async getMessage(messageId: string): Promise<SentDmResult<SentDmMessage>> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(messageId)) {
      return { ok: false, error: localError('That message id is not valid.', 'carrier_rejected') };
    }
    const response = await this.request('GET', `/v3/messages/${messageId}`, {});
    if (!response.ok) {
      return response;
    }
    const data = response.data;
    const events: SentDmMessageEvent[] = [];
    for (const item of Array.isArray(data.events) ? data.events : []) {
      const row = record(item);
      const status = text(row?.status);
      if (status !== null) {
        events.push({
          status,
          timestamp: text(row?.timestamp) ?? '',
          reasonCode: text(row?.reason_code),
        });
      }
    }
    return {
      ...response,
      data: {
        id: text(data.id) ?? messageId,
        phone: text(data.phone),
        templateId: text(data.template_id),
        channel: text(data.channel),
        status: isSentDmStatus(data.status) ? data.status : null,
        createdAt: text(data.created_at),
        price: typeof data.price === 'number' ? data.price : null,
        reasonCode: text(data.reason_code),
        reason: text(data.reason),
        events,
      },
    };
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    extraHeaders: Record<string, string>,
    body?: string,
  ): Promise<SentDmResult<Record<string, unknown>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    let status: number;
    let raw: string;
    let sandboxHeader: string | null;
    try {
      const response = await this.fetchImpl(new URL(path, this.baseUrl).toString(), {
        method,
        headers: {
          accept: 'application/json',
          'x-api-key': this.apiKey,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...extraHeaders,
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
      status = response.status;
      raw = await response.text();
      sandboxHeader = response.headers.get('x-sandbox');
    } catch {
      return {
        ok: false,
        error: {
          kind: 'network',
          httpStatus: null,
          code: null,
          message: 'Sent could not be reached.',
          requestId: null,
          retryable: true,
          smsError: 'carrier_rejected',
        },
      };
    } finally {
      clearTimeout(timer);
    }
    if (status < 200 || status >= 300) {
      return { ok: false, error: mapSentDmError(status, raw) };
    }
    const envelope = readEnvelope(raw);
    if (envelope.success === false || envelope.data === null) {
      return {
        ok: false,
        error: mapSentDmError(status === 200 || status === 202 ? 500 : status, raw),
      };
    }
    return {
      ok: true,
      data: envelope.data,
      requestId: envelope.requestId,
      sandbox: sandboxHeader === 'true',
    };
  }
}

/** Turns a Sent send into the worker's provider result. One recipient per SMSVIO message. */
export function sentDmSendResult(result: SentDmResult<SentDmSendData>): ProviderSendResult {
  if (!result.ok) {
    return result.error.retryable
      ? { status: 'temporary_failure', errorCode: result.error.smsError }
      : { status: 'permanent_failure', errorCode: result.error.smsError };
  }
  const recipient = result.data.recipients[0];
  if (recipient === undefined) {
    return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
  }
  return {
    status: 'accepted',
    providerMessageId: recipient.messageId,
    ...(result.requestId === null ? {} : { providerRequestId: result.requestId }),
    ...(recipient.channel === '' ? {} : { channel: recipient.channel }),
    ...(result.data.templateId === null ? {} : { providerTemplateId: result.data.templateId }),
  };
}

// Webhooks

export type SentDmVerifyResult =
  | { readonly ok: true; readonly eventId: string }
  | {
      readonly ok: false;
      readonly reason: 'missing_headers' | 'bad_secret' | 'stale' | 'bad_signature';
    };

function headerValue(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && value !== undefined && value !== '') {
      return value;
    }
  }
  return undefined;
}

function secretBytes(secret: string): Buffer | null {
  const encoded = secret.trim().replace(/^whsec_/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return null;
  }
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.length === 0 ? null : bytes;
}

/** `v1,` + base64 HMAC-SHA256 over `{id}.{timestamp}.{rawBody}`, as Sent and Standard Webhooks sign. */
export function signSentDmWebhook(
  secret: string,
  id: string,
  timestamp: string,
  rawBody: string,
): string {
  const key = secretBytes(secret);
  if (key === null) {
    throw new Error('The Sent webhook secret is not valid base64.');
  }
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')}`;
}

/**
 * Verifies a Sent webhook against the raw body. Version 2 sends webhook-id, webhook-timestamp,
 * and webhook-signature; version 1 sends the X-Webhook-* equivalents. Any listed signature may match.
 */
export function verifySentDmWebhook(input: {
  readonly secret: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly rawBody: string;
  readonly nowSeconds?: number;
  readonly toleranceSeconds?: number;
}): SentDmVerifyResult {
  const v2 = headerValue(input.headers, 'webhook-id') !== undefined;
  const id = headerValue(input.headers, v2 ? 'webhook-id' : 'x-webhook-id');
  const timestamp = headerValue(input.headers, v2 ? 'webhook-timestamp' : 'x-webhook-timestamp');
  const signatures = headerValue(input.headers, v2 ? 'webhook-signature' : 'x-webhook-signature');
  const eventId = v2 ? id : headerValue(input.headers, 'x-webhook-event-id');
  if (
    id === undefined ||
    timestamp === undefined ||
    signatures === undefined ||
    eventId === undefined
  ) {
    return { ok: false, reason: 'missing_headers' };
  }
  const key = secretBytes(input.secret);
  if (key === null) {
    return { ok: false, reason: 'bad_secret' };
  }
  if (!/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: 'stale' };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? SENT_DM_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(timestamp)) > tolerance) {
    return { ok: false, reason: 'stale' };
  }
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${input.rawBody}`).digest();
  for (const candidate of signatures.split(' ')) {
    const [version, value] = candidate.split(',', 2);
    if (version !== 'v1' || value === undefined) {
      continue;
    }
    const given = Buffer.from(value, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      return { ok: true, eventId };
    }
  }
  return { ok: false, reason: 'bad_signature' };
}

export interface SentDmStatusEvent {
  readonly event: string;
  readonly messageId: string;
  readonly status: SentDmStatus;
  readonly reasonCode: string | null;
}

/** Reads an outbound message status event. Inbound, template, and other events return null. */
export function parseSentDmEvent(body: unknown): SentDmStatusEvent | null {
  const root = record(body);
  const payload = record(root?.payload);
  const event = text(root?.event);
  if (root?.field !== 'message' || event === null || payload === null) {
    return null;
  }
  const messageId = text(payload.message_id);
  const status = payload.message_status;
  if (messageId === null || messageId.length > 120 || !isSentDmStatus(status)) {
    return null;
  }
  return { event, messageId, status, reasonCode: text(payload.reason_code) };
}

/**
 * Receipt-queue token for a Sent status, or null when the status needs no change on our side.
 * See RECEIPT_OUTCOMES in sms/pipeline.ts for what each token does.
 */
export function sentDmReceiptToken(status: SentDmStatus, reasonCode: string | null): string | null {
  switch (status) {
    case 'DELIVERED':
    case 'READ':
      return 'delivered';
    case 'FAILED':
    case 'CANCELLED':
      return 'undelivered';
    case 'FILTERED':
      return reasonCode === 'BUSINESS_004' ? 'filtered_opt_out' : 'undelivered';
    case 'BLOCKED':
      if (reasonCode === 'BUSINESS_005' || reasonCode === 'BUSINESS_012') {
        return 'blocked_template';
      }
      if (reasonCode === null || reasonCode === 'BUSINESS_003' || reasonCode === 'BUSINESS_020') {
        return 'blocked';
      }
      return 'blocked_other';
    case 'QUEUED':
    case 'ROUTED':
    case 'SENT':
    case 'SCHEDULED':
      return null;
  }
}
