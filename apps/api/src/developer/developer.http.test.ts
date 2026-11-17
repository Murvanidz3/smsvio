import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PLATFORM_SETTING_ID } from '@smsvio/shared/billing';
import { PRISMA, REDIS } from '@smsvio/server';
import request, { type Agent, type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApp, createFastifyAdapter } from '../app.factory.js';
import { AppModule } from '../app.module.js';
import { MAILER, type OutboundEmail } from '../mail/mailer.js';
import { createMemoryDb, createMemoryRedis } from '../memory-db.js';
import { testEnv } from '../testing.js';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'smsvio-phase1-pass';
const sent: OutboundEmail[] = [];
const db = createMemoryDb();

let app: NestFastifyApplication;
let owner: Agent;
let other: Agent;
let csrf = '';

function tokenFrom(email: string): string {
  const message = sent.filter((item) => item.to === email).at(-1);
  const match = message?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (match?.[1] === undefined) {
    throw new Error(`no token for ${email}`);
  }
  return match[1];
}

function capture(response: Response): void {
  const header = response.headers['set-cookie'];
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const line = lines.find((entry) => entry.startsWith('smsvio_csrf='));
  if (line === undefined) {
    return;
  }
  csrf = decodeURIComponent(line.split(';')[0]?.slice('smsvio_csrf='.length) ?? '');
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testEnv)] })
    .overrideProvider(PRISMA)
    .useValue(db)
    .overrideProvider(REDIS)
    .useValue(createMemoryRedis())
    .overrideProvider(MAILER)
    .useValue({
      send: (message: OutboundEmail) => {
        sent.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  app = await configureApp(
    moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(testEnv)),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = request.agent(app.getHttpServer());
  other = request.agent(app.getHttpServer());
  await db.country.create({
    data: {
      iso2: 'DE',
      name: 'Germany',
      dialCode: '49',
      alphaSenderAllowed: true,
      registrationRequired: false,
    },
  });
  await db.platformSetting.create({
    data: {
      id: PLATFORM_SETTING_ID,
      defaultDailySpendCapMicros: 0n,
      sharedSender: '12025550199',
    },
  });
});

afterAll(async () => {
  await app.close();
});

describe('developer platform', () => {
  it('issues keys, serves the public API, and manages webhooks', async () => {
    await owner
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send({
        name: 'Owner',
        email: 'dev@example.com',
        password: PASSWORD,
        organizationName: 'Dev Org',
      })
      .expect(200);
    const verified = await owner
      .post('/api/internal/auth/verify-email')
      .set('origin', ORIGIN)
      .send({ token: tokenFrom('dev@example.com') })
      .expect(200);
    capture(verified);
    const organizationId = verified.body.organization.id as string;
    const userId = verified.body.user.id as string;
    await db.user.update({ where: { id: userId }, data: { isPlatformAdmin: true } });
    await db.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } });

    await other
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send({
        name: 'Other',
        email: 'dev-other@example.com',
        password: PASSWORD,
        organizationName: 'Other Dev',
      })
      .expect(200);
    await other
      .post('/api/internal/auth/verify-email')
      .set('origin', ORIGIN)
      .send({ token: tokenFrom('dev-other@example.com') })
      .expect(200);

    const provider = await owner
      .post('/api/internal/admin/providers')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ code: 'mock', type: 'MOCK', markupPercent: 50, maxTps: 100, config: '{}' })
      .expect(200);
    await owner
      .post('/api/internal/admin/routes')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        countryIso2: 'DE',
        mccmnc: null,
        providerId: provider.body.id,
        priority: 10,
        weight: 1,
        cost: '0.0100',
        markupPercent: null,
        enabled: true,
      })
      .expect(200);
    await owner
      .post('/api/internal/org-countries')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ countryIso2: 'DE', senderId: null })
      .expect(200);

    const created = await owner
      .post('/api/internal/api-keys')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ name: 'CI', mode: 'TEST' })
      .expect(201);
    const secret = created.body.secret as string;
    expect(secret.startsWith('svk_test_')).toBe(true);
    const listed = await owner.get('/api/internal/api-keys').expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    expect(listed.body.organizationId).toBe(organizationId);
    expect(listed.body.items).toHaveLength(1);
    await owner
      .patch(`/api/internal/api-keys/${String(created.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ name: 'CI renamed' })
      .expect(200);
    await owner
      .patch(`/api/internal/api-keys/${String(created.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ status: 'DISABLED' })
      .expect(200);
    const disabled = await owner.get('/api/v1/balance').set('x-api-key', secret).expect(401);
    expect(disabled.headers['content-type']).toContain('application/problem+json');
    await owner
      .patch(`/api/internal/api-keys/${String(created.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await other.get(`/api/internal/api-keys/${String(created.body.id)}`).expect(404);

    const document = await owner.get('/api/v1/openapi.json').expect(200);
    expect(document.body.openapi).toBe('3.1.0');
    await owner.get('/api/v1/balance').expect(401);
    await owner.get('/api/v1/balance').set('x-api-key', 'svk_test_not-a-real-key').expect(401);
    const balance = await owner
      .get('/api/v1/balance')
      .set('authorization', `Bearer ${secret}`)
      .expect(200);
    expect(balance.body.currency).toBe('USD');
    expect(balance.headers['ratelimit-limit']).toBe('50');
    const rates = await owner.get('/api/v1/rates').set('x-api-key', secret).expect(200);
    expect(rates.body.items.length).toBeGreaterThan(0);
    const lookup = await owner
      .post('/api/v1/lookup')
      .set('x-api-key', secret)
      .send({ phone: '15123456789', country: 'DE' })
      .expect(200);
    expect(lookup.body.e164).toBe('+4915123456789');

    const contact = await owner
      .post('/api/v1/contacts')
      .set('x-api-key', secret)
      .send({ phone: '+4915123456789', name: 'Ada', attributes: { plan: 'test' } })
      .expect(201);
    expect(contact.body.phone).toBe('+4915123456789');
    await owner
      .post('/api/v1/contacts')
      .set('x-api-key', secret)
      .send({ phone: '+4915123456789' })
      .expect(409);
    const contacts = await owner.get('/api/v1/contacts').set('x-api-key', secret).expect(200);
    expect(contacts.body.items).toHaveLength(1);
    const updated = await owner
      .patch(`/api/v1/contacts/${String(contact.body.id)}`)
      .set('x-api-key', secret)
      .send({ opted_out: true })
      .expect(200);
    expect(updated.body.opted_out).toBe(true);
    await owner
      .patch(`/api/v1/contacts/${String(contact.body.id)}`)
      .set('x-api-key', secret)
      .send({ opted_out: false })
      .expect(200);

    const templates = await owner.get('/api/v1/templates').set('x-api-key', secret).expect(200);
    expect(templates.body.items).toEqual([]);
    await owner
      .get('/api/v1/templates/00000000-0000-4000-8000-000000000000')
      .set('x-api-key', secret)
      .expect(404);
    const senders = await owner.get('/api/v1/senders').set('x-api-key', secret).expect(200);
    expect(senders.body.platform_sender).toBe('12025550199');

    const accepted = await owner
      .post('/api/v1/messages')
      .set('x-api-key', secret)
      .set('idempotency-key', 'ref-1')
      .send({ to: '+4915123456789', text: 'Hello' })
      .expect(202);
    expect(accepted.body.status).toBe('queued');
    const replayed = await owner
      .post('/api/v1/messages')
      .set('x-api-key', secret)
      .send({ to: '+4915123456789', text: 'Hello', client_ref: 'ref-1' })
      .expect(202);
    expect(replayed.body.id).toBe(accepted.body.id);
    await owner
      .post('/api/v1/messages')
      .set('x-api-key', secret)
      .set('idempotency-key', 'other')
      .send({ to: '+4915123456789', text: 'Hello', client_ref: 'ref-1' })
      .expect(400);
    const messages = await owner
      .get('/api/v1/messages?status=queued')
      .set('x-api-key', secret)
      .expect(200);
    expect(messages.body.items.length).toBeGreaterThan(0);
    await owner
      .get(`/api/v1/messages/${String(accepted.body.id)}`)
      .set('x-api-key', secret)
      .expect(200);
    const batch = await owner
      .post('/api/v1/messages/batch')
      .set('x-api-key', secret)
      .set('idempotency-key', 'batch-1')
      .send({
        messages: [
          { to: '+4915123456789', text: 'One' },
          { to: 'not-a-number', text: 'Two' },
        ],
      })
      .expect(200);
    expect(batch.body.results).toHaveLength(2);
    const cached = await owner
      .post('/api/v1/messages/batch')
      .set('x-api-key', secret)
      .set('idempotency-key', 'batch-1')
      .send({ messages: [{ to: '+4915123456789', text: 'ignored' }] })
      .expect(200);
    expect(cached.body.results).toHaveLength(2);

    const webhook = await owner
      .post('/api/internal/webhooks')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        name: 'Primary',
        url: 'https://example.com/hooks',
        events: ['message.queued', 'contact.created'],
      })
      .expect(201);
    expect(String(webhook.body.secret).startsWith('whsec_')).toBe(true);
    const hookId = String(webhook.body.id);
    await other.get(`/api/internal/webhooks/${hookId}`).expect(404);
    const revealed = await owner
      .post(`/api/internal/webhooks/${hookId}/secret`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({})
      .expect(200);
    expect(revealed.body.secret).toBe(webhook.body.secret);
    const rotated = await owner
      .post(`/api/internal/webhooks/${hookId}/rotate`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({})
      .expect(200);
    expect(rotated.body.secret).not.toBe(webhook.body.secret);
    const tested = await owner
      .post(`/api/internal/webhooks/${hookId}/test`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({})
      .expect(200);
    const detail = await owner.get(`/api/internal/webhooks/${hookId}`).expect(200);
    expect(detail.body.deliveries.items.length).toBeGreaterThan(0);
    await owner
      .post(`/api/internal/webhooks/${hookId}/replay`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ delivery_id: tested.body.deliveryId })
      .expect(200);
    const publicHooks = await owner.get('/api/v1/webhooks').set('x-api-key', secret).expect(200);
    expect(publicHooks.body.items[0].consecutive_failures).toBeTypeOf('number');
    expect(JSON.stringify(publicHooks.body)).not.toContain('whsec_');
    await owner
      .patch(`/api/v1/webhooks/${hookId}`)
      .set('x-api-key', secret)
      .send({ status: 'DISABLED' })
      .expect(200);
    await owner
      .post(`/api/internal/webhooks/${hookId}/test`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({})
      .expect(409);
    await owner
      .patch(`/api/v1/webhooks/${hookId}`)
      .set('x-api-key', secret)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await owner.get('/api/internal/webhooks').expect(200);
    const shown = await owner
      .get(`/api/v1/webhooks/${hookId}`)
      .set('x-api-key', secret)
      .expect(200);
    expect(shown.body.secret).toBeUndefined();
    const extra = await owner
      .post('/api/v1/webhooks')
      .set('x-api-key', secret)
      .send({ name: 'Extra', url: 'https://example.com/extra', events: ['message.sent'] })
      .expect(201);
    await owner
      .delete(`/api/v1/webhooks/${String(extra.body.id)}`)
      .set('x-api-key', secret)
      .expect(200);
    await db.country.create({
      data: {
        iso2: 'US',
        name: 'United States',
        dialCode: '1',
        alphaSenderAllowed: true,
        registrationRequired: false,
      },
    });
    const ratesAgain = await owner.get('/api/v1/rates').set('x-api-key', secret).expect(200);
    expect(ratesAgain.body.items.some((item: { country: string }) => item.country === 'US')).toBe(
      false,
    );
    const page = await owner
      .get('/api/v1/messages?limit=1&to=%2B4915123456789&client_ref=ref-1')
      .set('x-api-key', secret)
      .expect(200);
    if (typeof page.body.next_cursor === 'string') {
      await owner
        .get(`/api/v1/messages?cursor=${encodeURIComponent(page.body.next_cursor)}`)
        .set('x-api-key', secret)
        .expect(200);
    }
    await owner.get('/api/v1/messages?cursor=nope').set('x-api-key', secret).expect(400);
    await owner
      .get('/api/v1/messages/00000000-0000-4000-8000-000000000000')
      .set('x-api-key', secret)
      .expect(404);
    await owner
      .get(`/api/v1/contacts/${String(contact.body.id)}`)
      .set('x-api-key', secret)
      .expect(200);
    await owner
      .post('/api/v1/lookup')
      .set('x-api-key', secret)
      .send({ phone: '+4915123456789' })
      .expect(200);
    const saved = await owner
      .post('/api/internal/templates')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        name: 'Hello',
        category: 'UTILITY',
        language: 'en',
        body: 'Hi {{name}}',
        samples: { name: 'Ada' },
      })
      .expect(200);
    const template = await owner
      .get(`/api/v1/templates/${String(saved.body.id)}`)
      .set('x-api-key', secret)
      .expect(200);
    expect(template.body.variables.name).toBe('Ada');
    const when = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await owner
      .post('/api/v1/messages')
      .set('x-api-key', secret)
      .set('idempotency-key', '   ')
      .send({ to: '+4915123456789', text: 'Later', scheduled_at: when })
      .expect(202);
    await owner
      .post('/api/v1/messages')
      .set('x-api-key', secret)
      .set('idempotency-key', 'x'.repeat(129))
      .send({ to: '+4915123456789', text: 'Nope' })
      .expect(400);
    const live = await owner
      .post('/api/internal/api-keys')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ name: 'Live', mode: 'LIVE' })
      .expect(201);
    const liveSend = await owner
      .post('/api/v1/messages')
      .set('x-api-key', String(live.body.secret))
      .send({ to: '+4915123456789', text: 'Charged' })
      .expect(400);
    expect(liveSend.body.code).toBe('spend_cap_reached');
    await owner
      .delete(`/api/v1/contacts/${String(contact.body.id)}`)
      .set('x-api-key', secret)
      .expect(200);
    await owner
      .delete(`/api/internal/webhooks/${hookId}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(200);
    let limited = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await owner.get('/api/v1/balance').set('x-api-key', secret);
      if (response.status === 429) {
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.headers['ratelimit-remaining']).toBe('0');
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
    await owner
      .delete(`/api/internal/api-keys/${String(created.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(200);
    await owner.get('/api/v1/balance').set('x-api-key', secret).expect(401);
  });
});
