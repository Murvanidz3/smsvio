import { MOCK_CALLBACK_SECRET, hashProviderSecret } from '@smsvio/shared/provider';
import { describe, expect, it } from 'vitest';

import { createMemoryDb } from '../memory-db.js';
import { acceptProviderCallback } from './provider-hook.js';

function redis() {
  const members = new Map<string, { score: number; member: string }>();
  return {
    members,
    zadd: (key: string, score: number, member: string) => {
      members.set(`${key}:${member}`, { score, member });
      return Promise.resolve(1);
    },
  };
}

describe('provider callbacks', () => {
  it('queues a signed receipt once and ignores a repeat or a bad signature', async () => {
    const db = createMemoryDb();
    await db.provider.create({
      data: {
        code: 'mock',
        type: 'MOCK',
        status: 'ACTIVE',
        maxTps: 100,
        markupPercent: 50,
        configEnc: null,
        callbackSecretHash: hashProviderSecret(MOCK_CALLBACK_SECRET),
      },
    });
    const cache = redis();
    const raw = {
      headers: { 'x-mock-signature': MOCK_CALLBACK_SECRET },
      body: { id: 'mock_1', status: 'expired' },
    };
    await expect(acceptProviderCallback(db as never, cache, 'mock', raw, 10)).resolves.toBe(1);
    await expect(acceptProviderCallback(db as never, cache, 'mock', raw, 11)).resolves.toBe(1);
    await expect(
      acceptProviderCallback(
        db as never,
        cache,
        'mock',
        { headers: raw.headers, body: { id: 'mock_1', status: 'delivered' } },
        12,
      ),
    ).resolves.toBe(1);
    const queued = [...cache.members.values()].map((entry) => entry.member).sort();
    expect(queued).toEqual(['delivered:mock_1', 'expired:mock_1']);
    await expect(
      acceptProviderCallback(
        db as never,
        cache,
        'mock',
        { headers: { 'x-mock-signature': 'wrong' }, body: raw.body },
        12,
      ),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    await expect(acceptProviderCallback(db as never, cache, 'http', raw, 13)).rejects.toMatchObject(
      { status: 404 },
    );
    const empty = createMemoryDb();
    await expect(
      acceptProviderCallback(empty as never, cache, 'mock', raw, 14),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      acceptProviderCallback(
        db as never,
        cache,
        'mock',
        { headers: raw.headers, body: { id: 'mock_2', status: 'failed' } },
        15,
      ),
    ).resolves.toBe(1);
    expect([...cache.members.values()].map((entry) => entry.member)).toContain(
      'undelivered:mock_2',
    );
  });
});
