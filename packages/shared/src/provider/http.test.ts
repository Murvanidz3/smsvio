import { describe, expect, it } from 'vitest';

import { httpProviderConfigSchema, interpretHttpReceipt, interpretHttpSend } from './http.js';

const config = httpProviderConfigSchema.parse({ url: 'https://upstream.example/sms' });

describe('HTTP provider mapping', () => {
  it('accepts a JSON id and treats a client error as permanent', () => {
    expect(interpretHttpSend(config, { status: 202, body: '{"id":"up-1"}' })).toEqual({
      status: 'accepted',
      providerMessageId: 'up-1',
    });
    expect(interpretHttpSend(config, { status: 400, body: '{}' }).status).toBe('permanent_failure');
    expect(interpretHttpSend(config, { status: 503, body: 'nope' }).status).toBe(
      'temporary_failure',
    );
    expect(interpretHttpSend(config, { status: 200, body: '{"id":""}' }).status).toBe(
      'temporary_failure',
    );
  });

  it('maps vendor receipt words and ignores an unknown status', () => {
    expect(interpretHttpReceipt(config, { id: 'up-1', status: 'DELIVRD' })).toEqual({
      providerMessageId: 'up-1',
      status: 'delivered',
    });
    expect(interpretHttpReceipt(config, { id: 'up-1', status: 'QUEUED' })).toBeNull();
    expect(interpretHttpReceipt(config, { status: 'DELIVRD' })).toBeNull();
    expect(interpretHttpReceipt(config, { id: 'up-1', status: 'REJECTD' })?.status).toBe('failed');
    expect(interpretHttpReceipt(config, null)).toBeNull();
    expect(httpProviderConfigSchema.safeParse({ url: 'http://upstream.example' }).success).toBe(
      false,
    );
  });
});
