import { describe, expect, it } from 'vitest';

import { MockProvider, hashProviderSecret, mockSuffix } from './mock.js';

const request = {
  to: '+14155550100',
  from: '12025550199',
  body: 'Hello',
  encoding: 'GSM-7',
  segments: 1,
};

describe('MockProvider', () => {
  const provider = new MockProvider({
    callbackSecretHash: hashProviderSecret('secret'),
    nextId: () => 'id-1',
  });

  it('accepts a normal number and schedules delivery without leaving the process', async () => {
    const result = await provider.send(request);
    expect(result).toEqual({
      status: 'accepted',
      providerMessageId: 'mock_id-1',
      receipt: { status: 'delivered', delayMs: 1000 },
    });
    expect(provider.code).toBe('mock');
  });

  it('maps the magic suffixes onto fixed outcomes', async () => {
    const outcomes = new MockProvider({ callbackSecretHash: null, nextId: () => 'x' });
    await expect(outcomes.send({ ...request, to: '+10001001' })).resolves.toMatchObject({
      status: 'accepted',
      receipt: { status: 'delivered', delayMs: 1000 },
    });
    await expect(outcomes.send({ ...request, to: '1002' })).resolves.toMatchObject({
      receipt: { status: 'undelivered', delayMs: 1000 },
    });
    await expect(outcomes.send({ ...request, to: '1003' })).resolves.toEqual({
      status: 'permanent_failure',
      errorCode: 'carrier_rejected',
    });
    await expect(outcomes.send({ ...request, to: '1004' })).resolves.toMatchObject({
      receipt: { status: 'expired', delayMs: 1000 },
    });
    await expect(outcomes.send({ ...request, to: '1005' })).resolves.toMatchObject({
      receipt: { status: 'delivered', delayMs: 30_000 },
    });
    await expect(outcomes.send({ ...request, to: '1006' })).resolves.toEqual({
      status: 'temporary_failure',
      errorCode: 'carrier_rejected',
    });
    expect(mockSuffix('+1 (415) 555-1001')).toBe('1001');
  });

  it('checks the callback secret and parses receipts and inbound messages', async () => {
    expect(provider.verifyCallback({ headers: { 'X-Mock-Signature': 'secret' }, body: {} })).toBe(
      true,
    );
    expect(provider.verifyCallback({ headers: { 'x-mock-signature': 'other' }, body: {} })).toBe(
      false,
    );
    expect(
      provider.verifyCallback({ headers: { 'x-mock-signature': 'secret-extra' }, body: {} }),
    ).toBe(false);
    expect(provider.verifyCallback({ headers: {}, body: {} })).toBe(false);
    expect(provider.verifyCallback({ headers: { 'x-mock-signature': '' }, body: {} })).toBe(false);
    const unsigned = new MockProvider({ callbackSecretHash: null });
    expect(unsigned.verifyCallback({ headers: { 'x-mock-signature': 'secret' }, body: {} })).toBe(
      false,
    );
    expect(
      provider.parseDeliveryReceipts({
        headers: {},
        body: { id: 'mock_id-1', status: 'delivered' },
      }),
    ).toEqual([{ providerMessageId: 'mock_id-1', status: 'delivered' }]);
    expect(
      provider.parseDeliveryReceipts({ headers: {}, body: { id: '', status: 'nope' } }),
    ).toEqual([]);
    expect(
      provider.parseDeliveryReceipts({ headers: {}, body: { id: 'a', status: 'queued' } }),
    ).toEqual([]);
    expect(
      provider.parseDeliveryReceipts({
        headers: {},
        body: { id: 'x'.repeat(121), status: 'delivered' },
      }),
    ).toEqual([]);
    expect(provider.parseDeliveryReceipts({ headers: {}, body: null })).toEqual([]);
    expect(provider.parseDeliveryReceipts({ headers: {}, body: 'nope' })).toEqual([]);
    expect(
      provider.parseDeliveryReceipts({ headers: {}, body: { id: 'a', status: 'failed' } }),
    ).toEqual([{ providerMessageId: 'a', status: 'failed' }]);
    expect(
      provider.parseInbound({ headers: {}, body: { from: '+1', to: 'SMSVIO', body: 'STOP' } }),
    ).toEqual([{ from: '+1', to: 'SMSVIO', body: 'STOP' }]);
    expect(provider.parseInbound({ headers: {}, body: { from: 1 } })).toEqual([]);
    expect(provider.parseInbound({ headers: {}, body: null })).toEqual([]);
    expect(provider.parseInbound({ headers: {}, body: 'STOP' })).toEqual([]);
    await expect(provider.healthCheck()).resolves.toEqual({
      ok: true,
      detail: 'Mock provider does not contact a carrier.',
    });
    const named = new MockProvider({ code: 'mock-2', callbackSecretHash: null });
    expect(named.code).toBe('mock-2');
    await expect(named.send(request)).resolves.toMatchObject({ status: 'accepted' });
  });
});
