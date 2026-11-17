import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { isBlockedDeliveryAddress, parseWebhookUrl } from './address.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import {
  API_KEY_RATE_LIMIT,
  WEBHOOK_EVENTS,
  WEBHOOK_RETRY_DELAYS_MS,
  isWebhookEvent,
  webhookRetryDelayMs,
} from './events.js';
import {
  apiKeyLast4,
  apiKeyMode,
  apiKeyPrefix,
  createApiKey,
  createWebhookSecret,
  decryptString,
  encryptString,
  maskApiKey,
  signWebhook,
  webhookSignaturesEqual,
} from './node.js';
import { openApiDocument, openApiOperations, parameterSchema } from './openapi.js';
import { problemDetails } from './problem.js';
import { WEBHOOK_SIGNATURE_GUIDE, codeSamples } from './samples.js';
import {
  publicBatchSchema,
  publicContactPatchSchema,
  publicSendSchema,
  updateApiKeySchema,
  webhookPatchSchema,
  webhookWriteSchema,
} from './schemas.js';

describe('developer platform helpers', () => {
  it('builds live and test keys and signs webhooks', () => {
    const live = createApiKey('LIVE');
    const test = createApiKey('TEST');
    expect(apiKeyMode(live)).toBe('LIVE');
    expect(apiKeyMode(test)).toBe('TEST');
    expect(apiKeyMode('svk_live_short')).toBeNull();
    expect(apiKeyMode('nope')).toBeNull();
    expect(maskApiKey(apiKeyPrefix(live), apiKeyLast4(live))).toContain('…');
    const secret = createWebhookSecret();
    const header = signWebhook(secret, 'msg_1', '1700000000', '{"ok":true}');
    expect(header.startsWith('v1,')).toBe(true);
    expect(webhookSignaturesEqual(header, header)).toBe(true);
    expect(webhookSignaturesEqual(header, 'v1,other')).toBe(false);
    expect(webhookSignaturesEqual('aa', 'aaa')).toBe(false);
    expect(() => signWebhook('whsec_YQ==', 'msg_1', '1', '{}')).toThrow(/too short/);
    const raw = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
    expect(signWebhook(raw, 'msg_1', '1', '{}').startsWith('v1,')).toBe(true);
    const key = 'ab'.repeat(32);
    const cipher = encryptString('secret-value', key);
    expect(decryptString(cipher, key)).toBe('secret-value');
    expect(() => decryptString('nope', key)).toThrow(/could not be read/);
    expect(() => decryptString(`${cipher.slice(0, -4)}aaaa`, key)).toThrow(Error);
    expect(() => encryptString('value', 'abcd')).toThrow(/32 bytes/);
  });

  it('retries for about a day and names every event', () => {
    const span = WEBHOOK_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(span).toBeGreaterThan(20 * 60 * 60 * 1000);
    expect(span).toBeLessThan(28 * 60 * 60 * 1000);
    expect(webhookRetryDelayMs(1)).toBe(WEBHOOK_RETRY_DELAYS_MS[0]);
    expect(webhookRetryDelayMs(0)).toBeNull();
    expect(webhookRetryDelayMs(WEBHOOK_RETRY_DELAYS_MS.length + 1)).toBeNull();
    expect(isWebhookEvent('message.queued')).toBe(true);
    expect(isWebhookEvent('message.received')).toBe(true);
    expect(isWebhookEvent('nope')).toBe(false);
    expect(API_KEY_RATE_LIMIT).toBe(50);
    expect(WEBHOOK_EVENTS.length).toBeGreaterThan(10);
  });

  it('blocks non-global addresses and accepts public ones', () => {
    for (const blocked of [
      '',
      '127.0.0.1',
      '10.1.2.3',
      '100.64.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.1',
      '192.0.0.1',
      '192.0.2.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '0.0.0.0',
      '::',
      '::1',
      'fc00::1',
      'fd00::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '100::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      'not-an-ip',
      '1.2.3',
      '1.2.3.256',
      '1.2.3.x',
      '1.2.3.4.5',
      'gggg::1',
      '1:2:3:4:5:6:7:8:9',
      ':::1',
      '::ffff:1.2.3.999',
      '1::2::3',
      '1:2:3:4:5:6:7:8::9',
      '::ffff:not-an-ip',
    ]) {
      expect(isBlockedDeliveryAddress(blocked), blocked).toBe(true);
    }
    expect(isBlockedDeliveryAddress('8.8.8.8')).toBe(false);
    expect(isBlockedDeliveryAddress('172.32.0.1')).toBe(false);
    expect(isBlockedDeliveryAddress('1.1.1.1')).toBe(false);
    expect(isBlockedDeliveryAddress('2001:4860:4860::8888')).toBe(false);
    expect(isBlockedDeliveryAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('accepts only public HTTPS webhook URLs', () => {
    expect(parseWebhookUrl('https://example.com/hooks').ok).toBe(true);
    expect(parseWebhookUrl(`https://${'a'.repeat(2100)}`).ok).toBe(false);
    expect(parseWebhookUrl('http://example.com/hooks').ok).toBe(false);
    expect(parseWebhookUrl('not a url').ok).toBe(false);
    expect(parseWebhookUrl('https://user:pass@example.com/hooks').ok).toBe(false);
    expect(parseWebhookUrl('https://localhost/hooks').ok).toBe(false);
    expect(parseWebhookUrl('https://printer.local/hooks').ok).toBe(false);
    expect(parseWebhookUrl('https://app.internal/hooks').ok).toBe(false);
    expect(parseWebhookUrl('https://box.localdomain/hooks').ok).toBe(false);
    expect(parseWebhookUrl('https://127.0.0.1/hooks').ok).toBe(false);
    expect(parseWebhookUrl('https://[::1]/hooks').ok).toBe(false);
    expect(parseWebhookUrl('https://example.com./hooks').ok).toBe(true);
    expect(parseWebhookUrl('https://example.com:0/hooks').ok).toBe(false);
    const parsed = parseWebhookUrl('https://hooks.example.com:8443/sms?x=1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.target.port).toBe(8443);
      expect(parsed.target.path).toBe('/sms?x=1');
    }
  });

  it('round-trips cursors and describes problems', () => {
    const createdAt = new Date('2026-11-17T00:00:00.000Z');
    const id = '11111111-1111-4111-8111-111111111111';
    const cursor = encodeCursor(createdAt, id);
    expect(decodeCursor(cursor)).toEqual({ createdAt, id });
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('a'.repeat(201))).toBeNull();
    expect(decodeCursor('@@@@')).toBeNull();
    expect(decodeCursor(encodeCursor(createdAt, 'nope'))).toBeNull();
    expect(decodeCursor(btoa('not-a-date|11111111-1111-4111-8111-111111111111'))).toBeNull();
    expect(decodeCursor(btoa('nouuid'))).toBeNull();
    const problem = problemDetails({
      status: 400,
      code: 'invalid_number',
      detail: 'Bad number',
      instance: '/api/v1/messages',
      errors: { to: 'Required' },
    });
    expect(problem.type).toBe('https://smsvio.com/docs/errors/invalid_number');
    expect(problem.errors?.to).toBe('Required');
    expect(
      problemDetails({
        status: 401,
        code: 'unauthenticated',
        detail: 'Sign in',
        instance: '/api/v1/balance',
      }).title,
    ).toBe('Authentication required');
    expect(
      problemDetails({
        status: 400,
        code: 'invalid_number',
        detail: 'Bad',
        instance: '/x',
        errors: {},
      }).errors,
    ).toBeUndefined();
  });

  it('validates public payloads and publishes an OpenAPI document', () => {
    expect(publicSendSchema.safeParse({ to: '+14155552671', text: 'Hi' }).success).toBe(true);
    expect(publicSendSchema.safeParse({ to: '+14155552671' }).success).toBe(false);
    expect(
      publicSendSchema.safeParse({
        to: '+14155552671',
        text: 'Hi',
        template_id: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
    expect(
      publicSendSchema.safeParse({
        to: '+14155552671',
        text: 'Hi',
        scheduled_at: '2020-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      publicSendSchema.safeParse({
        to: '+14155552671',
        text: 'Hi',
        scheduled_at: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
      }).success,
    ).toBe(false);
    expect(
      publicSendSchema.safeParse({
        to: '+14155552671',
        text: 'Hi',
        scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }).success,
    ).toBe(true);
    expect(publicBatchSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(updateApiKeySchema.safeParse({}).success).toBe(false);
    expect(updateApiKeySchema.safeParse({ name: 'CI' }).success).toBe(true);
    expect(updateApiKeySchema.safeParse({ status: 'DISABLED' }).success).toBe(true);
    expect(publicContactPatchSchema.safeParse({}).success).toBe(false);
    expect(publicContactPatchSchema.safeParse({ name: null }).success).toBe(true);
    expect(publicContactPatchSchema.safeParse({ attributes: { plan: 'a' } }).success).toBe(true);
    expect(publicContactPatchSchema.safeParse({ opted_out: true }).success).toBe(true);
    expect(webhookPatchSchema.safeParse({}).success).toBe(false);
    expect(webhookPatchSchema.safeParse({ name: 'B' }).success).toBe(true);
    expect(webhookPatchSchema.safeParse({ url: 'https://example.com/hook' }).success).toBe(true);
    expect(webhookPatchSchema.safeParse({ events: ['message.sent'] }).success).toBe(true);
    expect(webhookPatchSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
    expect(
      webhookWriteSchema.safeParse({
        name: 'A',
        url: 'http://example.com',
        events: ['message.sent'],
      }).success,
    ).toBe(false);
    expect(
      webhookWriteSchema.safeParse({ name: 'A', url: 'https://example.com/hook', events: ['nope'] })
        .success,
    ).toBe(false);
    expect(
      webhookWriteSchema.safeParse({
        name: 'A',
        url: 'https://example.com/hook',
        events: ['message.sent'],
      }).success,
    ).toBe(true);
    const document = openApiDocument();
    expect(document.openapi).toBe('3.1.0');
    const paths = document.paths as Record<string, unknown>;
    expect(paths['/api/v1/messages']).toBeDefined();
    expect(paths['/api/v1/lookup']).toBeDefined();
    const samples = openApiOperations()[0]?.samples;
    expect(samples?.curl).toContain('x-api-key');
    expect(samples?.node).toContain('fetch');
    expect(samples?.python).toContain('requests');
    expect(samples?.php).toContain('curl_init');
    const empty = codeSamples('get', '/api/v1/balance', undefined);
    expect(empty.curl).toContain('GET');
    expect(empty.node).not.toContain('JSON.stringify');
    expect(WEBHOOK_SIGNATURE_GUIDE).toContain('webhook-id');
    expect(WEBHOOK_SIGNATURE_GUIDE).toContain('whsec_');
    expect(parameterSchema(z.string())).toEqual([]);
    expect(
      parameterSchema(z.object({ limit: z.number() })).some((item) => item.name === 'limit'),
    ).toBe(true);
  });
});
