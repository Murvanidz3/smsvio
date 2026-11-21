import { describe, expect, it, vi } from 'vitest';

import { RECEIPT_OUTCOMES, receiptOutcome, transitionMessage } from '../sms/pipeline.js';
import {
  SENT_DM_STATUSES,
  SentDmClient,
  type SentDmFetch,
  mapSentDmError,
  parseSentDmEvent,
  sentDmReceiptToken,
  sentDmSendResult,
  sentDmSettingsFromEnv,
  signSentDmWebhook,
  verifySentDmWebhook,
} from './sent-dm.js';

const SECRET = `whsec_${Buffer.from('sent-test-signing-secret').toString('base64')}`;

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function client(fetch: SentDmFetch, sandbox = false) {
  return new SentDmClient({ apiKey: 'test-key', baseUrl: 'https://sent.example', sandbox, fetch });
}

const accepted = {
  success: true,
  data: {
    status: 'QUEUED',
    template_id: 'tpl-sent-1',
    recipients: [{ message_id: 'msg-1', to: '+995599780780', channel: 'sms', body: 'Hi' }],
  },
  error: null,
  meta: { request_id: 'req_1', timestamp: '2026-11-21T09:00:00Z', version: 'v3' },
};

describe('SentDmClient.sendMessage', () => {
  it('posts a template send with the key header and reads the recipients', async () => {
    const fetch = vi.fn<SentDmFetch>(() => Promise.resolve(reply(202, accepted)));
    const result = await client(fetch).sendMessage({
      to: ['+995599780780'],
      templateId: 'tpl-sent-1',
      variables: { name: 'Luka' },
      idempotencyKey: 'f9b2c3d4-0000-4000-8000-000000000001',
    });
    expect(result).toEqual({
      ok: true,
      requestId: 'req_1',
      sandbox: false,
      data: {
        status: 'QUEUED',
        templateId: 'tpl-sent-1',
        recipients: [{ messageId: 'msg-1', to: '+995599780780', channel: 'sms' }],
      },
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://sent.example/v3/messages');
    expect(init?.method).toBe('POST');
    expect(init?.headers['x-api-key']).toBe('test-key');
    expect(init?.headers['Idempotency-Key']).toBe('f9b2c3d4-0000-4000-8000-000000000001');
    expect(JSON.parse(init?.body ?? '')).toEqual({
      to: ['+995599780780'],
      template: { id: 'tpl-sent-1', parameters: { name: 'Luka' } },
      channel: ['sms'],
    });
    expect(sentDmSendResult(result)).toEqual({
      status: 'accepted',
      providerMessageId: 'msg-1',
      providerRequestId: 'req_1',
      channel: 'sms',
      providerTemplateId: 'tpl-sent-1',
    });
  });

  it('adds sandbox: true only when the flag is on', async () => {
    const fetch = vi.fn<SentDmFetch>(() =>
      Promise.resolve(reply(202, accepted, { 'x-sandbox': 'true' })),
    );
    const result = await client(fetch, true).sendMessage({
      to: ['+995599780780'],
      templateId: 't',
    });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body ?? '')).toMatchObject({ sandbox: true });
    expect(result.ok && result.sandbox).toBe(true);
  });

  it('refuses a non E.164 number without calling Sent', async () => {
    const fetch = vi.fn<SentDmFetch>();
    const result = await client(fetch).sendMessage({ to: ['599780780'], templateId: 't' });
    expect(fetch).not.toHaveBeenCalled();
    expect(sentDmSendResult(result)).toEqual({
      status: 'permanent_failure',
      errorCode: 'invalid_number',
    });
  });

  it('maps 401, 400, 404, 429, 5xx and network errors', async () => {
    const cases: [number, unknown, string, string][] = [
      [
        401,
        { success: false, error: { code: 'AUTH_002' } },
        'permanent_failure',
        'provider_auth_failed',
      ],
      [
        400,
        { success: false, error: { code: 'VALIDATION_002' } },
        'permanent_failure',
        'invalid_number',
      ],
      [
        400,
        { success: false, error: { code: 'VALIDATION_004', details: { template: ['required'] } } },
        'permanent_failure',
        'template_not_approved',
      ],
      [
        404,
        { success: false, error: { code: 'RESOURCE_002' } },
        'permanent_failure',
        'template_not_approved',
      ],
      [
        429,
        { success: false, error: { code: 'BUSINESS_002' } },
        'temporary_failure',
        'rate_limited',
      ],
      [503, 'unavailable', 'temporary_failure', 'carrier_rejected'],
    ];
    for (const [status, body, outcome, code] of cases) {
      const fetch = vi.fn<SentDmFetch>(() => Promise.resolve(reply(status, body)));
      const result = await client(fetch).sendMessage({ to: ['+995599780780'], templateId: 't' });
      expect(sentDmSendResult(result)).toEqual({ status: outcome, errorCode: code });
    }
    const offline = vi.fn<SentDmFetch>(() => Promise.reject(new Error('offline')));
    const result = await client(offline).sendMessage({ to: ['+995599780780'], templateId: 't' });
    expect(result.ok ? null : result.error.kind).toBe('network');
    expect(mapSentDmError(401, '{"meta":{"request_id":"req_9"}}')).toMatchObject({
      kind: 'auth',
      requestId: 'req_9',
      retryable: false,
    });
  });
});

describe('SentDmClient.getMessage', () => {
  it('reads status, price, and events', async () => {
    const fetch = vi.fn<SentDmFetch>(() =>
      Promise.resolve(
        reply(200, {
          success: true,
          data: {
            id: 'msg-1',
            phone: '+995599780780',
            template_id: 'tpl-sent-1',
            channel: 'sms',
            status: 'DELIVERED',
            created_at: '2026-11-21T09:00:00Z',
            price: 0.0055,
            events: [{ status: 'QUEUED', timestamp: '2026-11-21T09:00:00Z', reason_code: null }],
          },
          meta: { request_id: 'req_2' },
        }),
      ),
    );
    const result = await client(fetch).getMessage('msg-1');
    expect(fetch.mock.calls[0]?.[0]).toBe('https://sent.example/v3/messages/msg-1');
    expect(fetch.mock.calls[0]?.[1].method).toBe('GET');
    expect(result.ok && result.data).toMatchObject({
      id: 'msg-1',
      status: 'DELIVERED',
      price: 0.0055,
      events: [{ status: 'QUEUED', reasonCode: null }],
    });
    const bad = await client(fetch).getMessage('../x');
    expect(bad.ok).toBe(false);
  });
});

describe('sentDmSettingsFromEnv', () => {
  it('is off without a key and reads the sandbox flag', () => {
    expect(sentDmSettingsFromEnv({})).toBeNull();
    expect(sentDmSettingsFromEnv({ SENT_DM_API_KEY: 'k', SENT_DM_SANDBOX: 'true' })).toEqual({
      apiKey: 'k',
      baseUrl: 'https://api.sent.dm',
      sandbox: true,
    });
  });
});

describe('verifySentDmWebhook', () => {
  const body = JSON.stringify({ field: 'message', event: 'message.delivered' });
  const now = 1_763_715_600;
  const headers = (signature: string, timestamp = String(now)) => ({
    'webhook-id': 'evt_1',
    'webhook-timestamp': timestamp,
    'webhook-signature': signature,
  });

  it('accepts a valid signature, also among several', () => {
    const signature = signSentDmWebhook(SECRET, 'evt_1', String(now), body);
    expect(
      verifySentDmWebhook({
        secret: SECRET,
        headers: headers(signature),
        rawBody: body,
        nowSeconds: now,
      }),
    ).toEqual({ ok: true, eventId: 'evt_1' });
    expect(
      verifySentDmWebhook({
        secret: SECRET,
        headers: headers(`v1,AAAA ${signature}`),
        rawBody: body,
        nowSeconds: now + 299,
      }),
    ).toEqual({ ok: true, eventId: 'evt_1' });
  });

  it('rejects a changed body, a wrong secret, and missing headers', () => {
    const signature = signSentDmWebhook(SECRET, 'evt_1', String(now), body);
    expect(
      verifySentDmWebhook({
        secret: SECRET,
        headers: headers(signature),
        rawBody: `${body} `,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    const other = `whsec_${Buffer.from('another-secret').toString('base64')}`;
    expect(
      verifySentDmWebhook({
        secret: other,
        headers: headers(signature),
        rawBody: body,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(
      verifySentDmWebhook({ secret: SECRET, headers: {}, rawBody: body, nowSeconds: now }),
    ).toEqual({ ok: false, reason: 'missing_headers' });
  });

  it('rejects a stale or future timestamp', () => {
    const old = String(now - 301);
    const signature = signSentDmWebhook(SECRET, 'evt_1', old, body);
    expect(
      verifySentDmWebhook({
        secret: SECRET,
        headers: headers(signature, old),
        rawBody: body,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: 'stale' });
    const future = String(now + 301);
    expect(
      verifySentDmWebhook({
        secret: SECRET,
        headers: headers(signSentDmWebhook(SECRET, 'evt_1', future, body), future),
        rawBody: body,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: 'stale' });
  });

  it('verifies version 1 headers and dedupes on the event id', () => {
    const signature = signSentDmWebhook(SECRET, 'hook_1', String(now), body);
    expect(
      verifySentDmWebhook({
        secret: SECRET,
        headers: {
          'X-Webhook-ID': 'hook_1',
          'X-Webhook-Event-ID': 'evt_9',
          'X-Webhook-Timestamp': String(now),
          'X-Webhook-Signature': signature,
        },
        rawBody: body,
        nowSeconds: now,
      }),
    ).toEqual({ ok: true, eventId: 'evt_9' });
  });
});

describe('Sent status mapping', () => {
  it('parses message events and ignores everything else', () => {
    expect(
      parseSentDmEvent({
        field: 'message',
        event: 'message.blocked',
        payload: { message_id: 'msg-1', message_status: 'BLOCKED', reason_code: 'BUSINESS_003' },
      }),
    ).toEqual({
      event: 'message.blocked',
      messageId: 'msg-1',
      status: 'BLOCKED',
      reasonCode: 'BUSINESS_003',
    });
    expect(
      parseSentDmEvent({ field: 'templates', event: 'templates.approved', payload: {} }),
    ).toBeNull();
    expect(
      parseSentDmEvent({
        field: 'message',
        event: 'message.received',
        payload: { message_id: 'm' },
      }),
    ).toBeNull();
    expect(
      parseSentDmEvent({
        field: 'message',
        event: 'message.x',
        payload: { message_id: 'm', message_status: 'PROCESSED' },
      }),
    ).toBeNull();
  });

  it('maps every Sent status to a receipt outcome or to no change', () => {
    const outcomes = Object.fromEntries(
      SENT_DM_STATUSES.map((status) => {
        const token = sentDmReceiptToken(status, null);
        return [status, token === null ? null : receiptOutcome(token)];
      }),
    );
    expect(outcomes).toEqual({
      QUEUED: null,
      ROUTED: null,
      SENT: null,
      SCHEDULED: null,
      DELIVERED: { status: 'DELIVERED', errorCode: null },
      READ: { status: 'DELIVERED', errorCode: null },
      FAILED: { status: 'UNDELIVERED', errorCode: 'carrier_rejected' },
      CANCELLED: { status: 'UNDELIVERED', errorCode: 'carrier_rejected' },
      FILTERED: { status: 'UNDELIVERED', errorCode: 'carrier_rejected' },
      BLOCKED: { status: 'BLOCKED', errorCode: 'provider_balance_low' },
    });
  });

  it('reads the reason code for BLOCKED and FILTERED', () => {
    expect(sentDmReceiptToken('BLOCKED', 'BUSINESS_003')).toBe('blocked');
    expect(sentDmReceiptToken('BLOCKED', 'BUSINESS_020')).toBe('blocked');
    expect(sentDmReceiptToken('BLOCKED', 'BUSINESS_005')).toBe('blocked_template');
    expect(sentDmReceiptToken('BLOCKED', 'BUSINESS_012')).toBe('blocked_template');
    expect(sentDmReceiptToken('BLOCKED', 'BUSINESS_029')).toBe('blocked_other');
    expect(sentDmReceiptToken('FILTERED', 'BUSINESS_004')).toBe('filtered_opt_out');
    expect(RECEIPT_OUTCOMES.filtered_opt_out.errorCode).toBe('recipient_opted_out');
    expect(receiptOutcome('constructor')).toBeNull();
  });

  it('lets a sent message become BLOCKED once and never leave it', () => {
    expect(transitionMessage('SENT', 'BLOCKED')).toBe('BLOCKED');
    expect(transitionMessage('BLOCKED', 'DELIVERED')).toBeNull();
    expect(transitionMessage('BLOCKED', 'BLOCKED')).toBeNull();
  });
});

describe('Sent client edge cases', () => {
  it('maps the remaining HTTP statuses and envelopes', async () => {
    expect(mapSentDmError(400, '{"error":{"details":{"to":["bad"]}}}').smsError).toBe(
      'invalid_number',
    );
    expect(mapSentDmError(400, 'not json').smsError).toBe('template_not_approved');
    expect(mapSentDmError(403, '').kind).toBe('auth');
    expect(mapSentDmError(302, '')).toMatchObject({ kind: 'unexpected', retryable: false });
    const refused = vi.fn<SentDmFetch>(() =>
      Promise.resolve(reply(200, { success: false, error: { code: 'X' } })),
    );
    const failed = await client(refused).sendMessage({ to: ['+995599780780'], templateId: 't' });
    expect(failed.ok ? null : failed.error.kind).toBe('server');
    const empty = vi.fn<SentDmFetch>(() => Promise.resolve(reply(201, { success: true })));
    const odd = await client(empty).sendMessage({ to: ['+995599780780'], templateId: 't' });
    expect(odd.ok ? null : odd.error.kind).toBe('unexpected');
  });

  it('uses defaults and the global fetch', async () => {
    const fetch = vi.fn(() => Promise.resolve(reply(202, accepted)));
    vi.stubGlobal('fetch', fetch);
    try {
      const result = await new SentDmClient({ apiKey: 'k' }).sendMessage({
        to: ['+995599780780'],
        templateId: 't',
      });
      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith('https://api.sent.dm/v3/messages', expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses an empty template id and reads sparse send responses', async () => {
    const none = vi.fn<SentDmFetch>();
    const blank = await client(none).sendMessage({ to: ['+995599780780'], templateId: ' ' });
    expect(sentDmSendResult(blank)).toEqual({
      status: 'permanent_failure',
      errorCode: 'template_not_approved',
    });
    expect(none).not.toHaveBeenCalled();
    const sparse = vi.fn<SentDmFetch>(() =>
      Promise.resolve(
        reply(202, { success: true, data: { recipients: [{}, { message_id: 'm' }] } }),
      ),
    );
    const result = await client(sparse).sendMessage({ to: ['+995599780780'], templateId: 't' });
    expect(result.ok && result.data).toEqual({
      status: 'QUEUED',
      templateId: null,
      recipients: [{ messageId: 'm', to: '', channel: '' }],
    });
    expect(sentDmSendResult(result)).toEqual({ status: 'accepted', providerMessageId: 'm' });
    const nobody = vi.fn<SentDmFetch>(() =>
      Promise.resolve(reply(202, { success: true, data: {} })),
    );
    const missing = await client(nobody).sendMessage({ to: ['+995599780780'], templateId: 't' });
    expect(sentDmSendResult(missing)).toEqual({
      status: 'temporary_failure',
      errorCode: 'carrier_rejected',
    });
  });

  it('reads sparse and failed message lookups', async () => {
    const sparse = vi.fn<SentDmFetch>(() =>
      Promise.resolve(
        reply(200, {
          success: true,
          data: { status: 'PROCESSED', price: '1', events: [{}, { status: 'SENT' }] },
        }),
      ),
    );
    const result = await client(sparse).getMessage('msg-2');
    expect(result.ok && result.data).toMatchObject({
      id: 'msg-2',
      status: null,
      price: null,
      events: [{ status: 'SENT', timestamp: '', reasonCode: null }],
    });
    const noEvents = vi.fn<SentDmFetch>(() =>
      Promise.resolve(reply(200, { success: true, data: { id: 'msg-3' } })),
    );
    const bare = await client(noEvents).getMessage('msg-3');
    expect(bare.ok && bare.data.events).toEqual([]);
    const missing = vi.fn<SentDmFetch>(() =>
      Promise.resolve(reply(404, { success: false, error: { code: 'RESOURCE_003' } })),
    );
    const lost = await client(missing).getMessage('msg-4');
    expect(lost.ok ? null : lost.error.kind).toBe('not_found');
  });

  it('rejects unusable secrets, timestamps, and signature formats', () => {
    const body = '{}';
    const now = Math.floor(Date.now() / 1000);
    expect(() => signSentDmWebhook('whsec_!!', 'a', '1', body)).toThrow();
    const headers = (signature: string, timestamp = String(now)) => ({
      'webhook-id': 'evt',
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    });
    const good = signSentDmWebhook(SECRET, 'evt', String(now), body);
    expect(
      verifySentDmWebhook({ secret: 'whsec_A', headers: headers(good), rawBody: body }),
    ).toEqual({
      ok: false,
      reason: 'bad_secret',
    });
    expect(
      verifySentDmWebhook({ secret: SECRET, headers: headers(good, 'soon'), rawBody: body }),
    ).toEqual({ ok: false, reason: 'stale' });
    expect(
      verifySentDmWebhook({ secret: SECRET, headers: headers('v2,abc v1'), rawBody: body }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifySentDmWebhook({ secret: SECRET, headers: headers(good), rawBody: body })).toEqual({
      ok: true,
      eventId: 'evt',
    });
    expect(
      verifySentDmWebhook({
        secret: SECRET,
        headers: {
          'x-webhook-id': 'h',
          'x-webhook-timestamp': String(now),
          'x-webhook-signature': good,
        },
        rawBody: body,
      }),
    ).toEqual({ ok: false, reason: 'missing_headers' });
    expect(parseSentDmEvent(null)).toBeNull();
    expect(
      parseSentDmEvent({
        field: 'message',
        event: 'message.sent',
        payload: { message_status: 'SENT' },
      }),
    ).toBeNull();
  });
});
