import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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
});

afterAll(async () => {
  await app.close();
});

describe('billing and overview', () => {
  it('shows usage, stores billing preferences, and refuses an unconfigured top-up', async () => {
    await owner
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send({
        name: 'Ada',
        email: 'billing-owner@example.com',
        password: PASSWORD,
        organizationName: 'Billing Org',
      })
      .expect(200);
    const verified = await owner
      .post('/api/internal/auth/verify-email')
      .set('origin', ORIGIN)
      .send({ token: tokenFrom('billing-owner@example.com') })
      .expect(200);
    capture(verified);
    const organizationId = verified.body.organization.id as string;

    await other
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send({
        name: 'Other',
        email: 'billing-other@example.com',
        password: PASSWORD,
        organizationName: 'Other Billing',
      })
      .expect(200);
    await other
      .post('/api/internal/auth/verify-email')
      .set('origin', ORIGIN)
      .send({ token: tokenFrom('billing-other@example.com') })
      .expect(200);

    await db.message.create({
      data: {
        organizationId,
        to: '+4915123456789',
        body: 'Hello',
        direction: 'OUTBOUND',
        status: 'DELIVERED',
        priceMicros: 15_000n,
        billable: true,
        countryIso2: 'DE',
      },
    });
    const overview = await owner.get('/api/internal/overview?range=today').expect(200);
    expect(overview.body.totals.sent).toBe(1);
    expect(overview.body.totals.delivered).toBe(1);
    expect(overview.body.deliverability).toBe(1);
    expect(overview.body.recentContacts).toEqual([]);
    await owner.get('/api/internal/overview?range=custom').expect(400);
    const today = new Date().toISOString().slice(0, 10);
    const custom = await owner
      .get(`/api/internal/overview?range=custom&from=${today}&to=${today}`)
      .expect(200);
    expect(custom.body.totals.sent).toBe(1);
    const empty = await owner.get('/api/internal/billing').expect(200);
    expect(empty.body.payments).toBe('unconfigured');
    expect(empty.body.autoRecharge).toBe('idle');
    expect(empty.body.preferences.email).toBe('');

    const saved = await owner
      .patch('/api/internal/billing')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        email: 'pay@example.com',
        name: 'Ada Billing',
        line1: '1 Main',
        city: 'Tbilisi',
        countryIso2: 'GE',
        lowBalance: '5.00',
        autoRechargeEnabled: true,
        autoRechargeThreshold: '5.00',
        autoRechargeAmount: '10.00',
      })
      .expect(200);
    expect(saved.body.email).toBe('pay@example.com');
    expect(saved.body.autoRechargeEnabled).toBe(true);
    await owner
      .patch('/api/internal/billing')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ autoRechargeEnabled: true, autoRechargeAmount: '1.00' })
      .expect(400);
    const view = await owner.get('/api/internal/billing').expect(200);
    expect(view.body.payments).toBe('unconfigured');
    expect(view.body.autoRecharge).toBe('below_threshold');
    await owner
      .patch('/api/internal/billing')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ email: 'not-an-email' })
      .expect(400);
    await owner
      .patch('/api/internal/billing')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ lowBalance: 'nope' })
      .expect(400);
    await owner
      .patch('/api/internal/billing')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ name: '   ' })
      .expect(200);
    await owner
      .patch('/api/internal/billing')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ email: '', name: null, lowBalance: '', autoRechargeEnabled: false })
      .expect(200);

    await owner
      .post('/api/internal/billing/top-ups')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ amount: '1.00' })
      .expect(400);
    const refused = await owner
      .post('/api/internal/billing/top-ups')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ amount: '10.00' })
      .expect(503);
    expect(refused.body.code).toBe('payments_unconfigured');

    const entry = await db.ledgerEntry.create({
      data: {
        organizationId,
        type: 'ADJUSTMENT',
        amountMicros: 10_000_000n,
        balanceAfterMicros: 10_000_000n,
        note: 'Opening credit',
      },
    });
    const charge = await db.ledgerEntry.create({
      data: {
        organizationId,
        type: 'CHARGE',
        amountMicros: -15_000n,
        balanceAfterMicros: 9_985_000n,
        note: '',
      },
    });
    const history = await owner.get('/api/internal/billing/entries').expect(200);
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Charge' }),
        expect.objectContaining({ description: 'Opening credit' }),
      ]),
    );
    const plain = await owner.get(`/api/internal/billing/entries/${charge.id}/receipt`).expect(200);
    expect(plain.text).toContain('Charge');
    expect(plain.text).not.toContain('Note:');
    const receipt = await owner
      .get(`/api/internal/billing/entries/${entry.id}/receipt`)
      .expect(200);
    expect(receipt.text).toContain('Opening credit');
    expect(receipt.headers['content-type']).toContain('text/plain');
    await other.get(`/api/internal/billing/entries/${entry.id}/receipt`).expect(404);

    const rates = await owner.get('/api/internal/pricing/rates').expect(200);
    expect(rates.body.items).toEqual([]);

    const memberships = await db.membership.findMany({ where: { organizationId } });
    const membership = memberships[0];
    if (membership === undefined) {
      throw new Error('missing membership');
    }
    await db.membership.update({ where: { id: membership.id }, data: { role: 'VIEWER' } });
    await owner.get('/api/internal/billing').expect(403);
    await owner.get('/api/internal/overview').expect(200);
    await db.membership.update({ where: { id: membership.id }, data: { role: 'OWNER' } });
  });
});
