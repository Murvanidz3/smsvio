import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RECEIPT_QUEUE_KEY } from '@smsvio/shared';
import { SENT_DM_RECEIPT_DELAY_MS, signSentDmWebhook } from '@smsvio/shared/provider';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadApiEnv } from '../env.js';
import { createFakeDependencies, createTestApp } from '../testing.js';
import { acceptSentDmWebhook, sentDmDedupeKey } from './sent-dm-hook.js';

const SECRET = `whsec_${Buffer.from('sent-webhook-test-secret').toString('base64')}`;
const NOW = 1_763_715_600_000;

function redis() {
  const keys = new Set<string>();
  const queued: { score: number; member: string }[] = [];
  return {
    keys,
    queued,
    set: vi.fn((key: string) => {
      if (keys.has(key)) {
        return Promise.resolve(null);
      }
      keys.add(key);
      return Promise.resolve('OK' as const);
    }),
    zadd: vi.fn((_key: string, score: number, member: string) => {
      queued.push({ score, member });
      return Promise.resolve(1);
    }),
    del: vi.fn((key: string) => Promise.resolve(keys.delete(key) ? 1 : 0)),
  };
}

function signed(body: unknown, id = 'msg_evt_1', seconds = Math.floor(NOW / 1000)) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    headers: {
      'webhook-id': id,
      'webhook-timestamp': String(seconds),
      'webhook-signature': signSentDmWebhook(SECRET, id, String(seconds), rawBody),
    },
  };
}

const delivered = {
  field: 'message',
  event: 'message.delivered',
  timestamp: '2026-11-21T09:00:00Z',
  payload: { message_id: 'sent-msg-1', message_status: 'DELIVERED', channel: 'sms' },
};

describe('acceptSentDmWebhook', () => {
  it('queues a verified status once per webhook-id', async () => {
    const cache = redis();
    await expect(acceptSentDmWebhook(cache, SECRET, signed(delivered), NOW)).resolves.toBe(
      'queued',
    );
    await expect(acceptSentDmWebhook(cache, SECRET, signed(delivered), NOW)).resolves.toBe(
      'duplicate',
    );
    expect(cache.queued).toEqual([
      { score: NOW + SENT_DM_RECEIPT_DELAY_MS, member: 'delivered:sent-msg-1' },
    ]);
    expect(cache.zadd).toHaveBeenCalledWith(
      RECEIPT_QUEUE_KEY,
      NOW + SENT_DM_RECEIPT_DELAY_MS,
      'delivered:sent-msg-1',
    );
  });

  it('maps BLOCKED with its reason and acknowledges events that change nothing', async () => {
    const cache = redis();
    const blocked = {
      field: 'message',
      event: 'message.blocked',
      payload: { message_id: 'sent-msg-2', message_status: 'BLOCKED', reason_code: 'BUSINESS_003' },
    };
    await acceptSentDmWebhook(cache, SECRET, signed(blocked, 'evt_b'), NOW);
    const routed = {
      field: 'message',
      event: 'message.routed',
      payload: { message_id: 'sent-msg-2', message_status: 'ROUTED' },
    };
    await expect(acceptSentDmWebhook(cache, SECRET, signed(routed, 'evt_r'), NOW)).resolves.toBe(
      'ignored',
    );
    expect(cache.queued.map((entry) => entry.member)).toEqual(['blocked:sent-msg-2']);
  });

  it('rejects a bad or stale signature and answers 404 when no secret is set', async () => {
    const cache = redis();
    const good = signed(delivered);
    await expect(
      acceptSentDmWebhook(cache, SECRET, { ...good, rawBody: `${good.rawBody} ` }, NOW),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      acceptSentDmWebhook(
        cache,
        SECRET,
        signed(delivered, 'old', Math.floor(NOW / 1000) - 301),
        NOW,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(acceptSentDmWebhook(cache, undefined, good, NOW)).rejects.toMatchObject({
      status: 404,
    });
    expect(cache.queued).toHaveLength(0);
  });

  it('releases the dedupe key when queuing fails so Sent can retry', async () => {
    const cache = redis();
    cache.zadd.mockRejectedValueOnce(new Error('redis down'));
    await expect(acceptSentDmWebhook(cache, SECRET, signed(delivered), NOW)).rejects.toThrow(
      'redis down',
    );
    expect(cache.keys.has(sentDmDedupeKey('msg_evt_1'))).toBe(false);
  });
});

describe('POST /api/hooks/sent-dm', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('verifies the raw body over HTTP and returns 204', async () => {
    const cache = redis();
    const deps = createFakeDependencies();
    Object.assign(deps.redis, { set: cache.set, zadd: cache.zadd, del: cache.del });
    app = await createTestApp(
      deps,
      loadApiEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
        REDIS_URL: 'redis://:pw@redis:6379',
        PUBLIC_ORIGIN: 'http://localhost:3000',
        APP_ENCRYPTION_KEY: 'ab'.repeat(32),
        TRUST_PROXY_HOPS: '0',
        SENT_DM_WEBHOOK_SECRET: SECRET,
      }),
    );
    const now = Math.floor(Date.now() / 1000);
    const event = signed(delivered, 'http_evt', now);
    await request(app.getHttpServer())
      .post('/api/hooks/sent-dm')
      .set(event.headers)
      .set('content-type', 'application/json')
      .send(event.rawBody)
      .expect(204);
    expect(cache.queued.map((entry) => entry.member)).toEqual(['delivered:sent-msg-1']);
    await request(app.getHttpServer())
      .post('/api/hooks/sent-dm')
      .set({ ...event.headers, 'webhook-signature': 'v1,AAAA' })
      .set('content-type', 'application/json')
      .send(event.rawBody)
      .expect(401);
  });
});
