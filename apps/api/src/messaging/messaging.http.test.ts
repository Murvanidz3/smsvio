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
let otherCsrf = '';

function tokenFrom(email: string): string {
  const message = sent.filter((item) => item.to === email).at(-1);
  const match = message?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (match?.[1] === undefined) {
    throw new Error(`no token for ${email}`);
  }
  return match[1];
}

function capture(response: Response, target: 'owner' | 'other'): void {
  const header = response.headers['set-cookie'];
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const line = lines.find((entry) => entry.startsWith('smsvio_csrf='));
  if (line === undefined) {
    return;
  }
  const value = decodeURIComponent(line.split(';')[0]?.slice('smsvio_csrf='.length) ?? '');
  if (target === 'owner') {
    csrf = value;
  } else {
    otherCsrf = value;
  }
}

async function signUp(
  agent: Agent,
  email: string,
  organizationName: string,
  who: 'owner' | 'other',
) {
  await agent
    .post('/api/internal/auth/signup')
    .set('origin', ORIGIN)
    .send({ name: 'Owner', email, password: PASSWORD, organizationName })
    .expect(200);
  const verified = await agent
    .post('/api/internal/auth/verify-email')
    .set('origin', ORIGIN)
    .send({ token: tokenFrom(email) })
    .expect(200);
  capture(verified, who);
  const user = verified.body.user as { id?: string };
  const organization = verified.body.organization as { id?: string };
  if (typeof user.id !== 'string' || typeof organization.id !== 'string') {
    throw new Error('missing session');
  }
  return { userId: user.id, organizationId: organization.id };
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
  await db.country.create({
    data: {
      iso2: 'US',
      name: 'United States',
      dialCode: '1',
      alphaSenderAllowed: false,
      registrationRequired: true,
    },
  });
});

afterAll(async () => {
  await app.close();
});

describe('messaging admin and senders', () => {
  it('prices routes, keeps the ledger aligned, and hides another organization', async () => {
    const ownerAccount = await signUp(owner, 'money@example.com', 'Money Org', 'owner');
    const otherAccount = await signUp(other, 'money-other@example.com', 'Other Money', 'other');
    await db.user.update({ where: { id: ownerAccount.userId }, data: { isPlatformAdmin: true } });

    await other.get('/api/internal/admin/organizations').expect(404);
    await other
      .post('/api/internal/admin/ledger/check')
      .set('origin', ORIGIN)
      .set('x-csrf-token', otherCsrf)
      .expect(404);

    const provider = await owner
      .post('/api/internal/admin/providers')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        code: 'mock',
        type: 'MOCK',
        markupPercent: 50,
        maxTps: 100,
        config: '{"systemId":"demo"}',
      })
      .expect(200);
    expect(typeof provider.body.callbackSecret).toBe('string');
    expect(JSON.stringify(provider.body)).not.toContain('demo');

    const route = await owner
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

    const described = await owner.get('/api/internal/admin/routes').expect(200);
    const row = (
      described.body.items as {
        id: string;
        markupSource: string;
        price: { display: string };
        margin: { display: string };
        setsListPrice: boolean;
      }[]
    ).find((item) => item.id === route.body.id);
    expect(row).toMatchObject({
      markupSource: 'provider',
      price: { display: '0.0150' },
      margin: { display: '0.0050' },
      setsListPrice: true,
    });

    await owner
      .patch(`/api/internal/admin/providers/${String(provider.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ markupPercent: 100, maxTps: 100, status: 'ACTIVE' })
      .expect(200);
    const repriced = await owner.get('/api/internal/admin/rates?country=DE').expect(200);
    expect(repriced.body.items[0]).toMatchObject({
      source: 'computed',
      price: { display: '0.0200' },
    });

    const preview = await owner
      .post('/api/internal/admin/rates/preview')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ csv: 'country,network,price\nDE,,0.0500\nNOPE,,0.0100\n' })
      .expect(200);
    expect(preview.body.ok).toBe(false);

    await owner
      .post('/api/internal/admin/rates/import')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ csv: 'country,network,price\nDE,,0.0500\n' })
      .expect(200);
    const manual = await owner.get('/api/internal/admin/rates?q=Germany').expect(200);
    expect(manual.body.items[0]).toMatchObject({ source: 'manual', price: { display: '0.0500' } });

    await owner
      .post('/api/internal/admin/rates/org')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        organizationId: ownerAccount.organizationId,
        countryIso2: 'DE',
        mccmnc: null,
        price: '0.0100',
      })
      .expect(200);
    const personal = await owner
      .get(`/api/internal/admin/rates?organizationId=${ownerAccount.organizationId}&q=DE`)
      .expect(200);
    expect(personal.body.items[0]).toMatchObject({
      source: 'per-customer',
      price: { display: '0.0100' },
    });

    const credited = await owner
      .post(`/api/internal/admin/organizations/${ownerAccount.organizationId}/balance`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ direction: 'credit', amount: '10.00', reason: 'Test credit' })
      .expect(200);
    expect(credited.body.balance.available.display).toBe('10.00');
    await owner
      .post(`/api/internal/admin/organizations/${ownerAccount.organizationId}/balance`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ direction: 'debit', amount: '40.00', reason: 'Too much to remove' })
      .expect(402);
    const check = await owner
      .post('/api/internal/admin/ledger/check')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(200);
    expect(check.body.differences).toEqual([]);

    await owner
      .patch('/api/internal/admin/settings')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ defaultDailySpendCap: '25.00' })
      .expect(200);
    const orgs = await owner.get('/api/internal/admin/organizations?q=Money').expect(200);
    const listed = (
      orgs.body.items as { id: string; spendCap: { display: string }; spendCapSource: string }[]
    ).find((item) => item.id === ownerAccount.organizationId);
    expect(listed).toMatchObject({ spendCap: { display: '25.00' }, spendCapSource: 'platform' });
    await owner
      .patch(`/api/internal/admin/organizations/${ownerAccount.organizationId}/spend-cap`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ dailySpendCap: '5.00' })
      .expect(200);
    await owner
      .post(`/api/internal/admin/organizations/${otherAccount.organizationId}/status`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    const health = await owner
      .post(`/api/internal/admin/providers/${String(provider.body.id)}/health`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(200);
    expect(health.body.ok).toBe(true);

    const added = await owner
      .post('/api/internal/org-countries')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ countryIso2: 'DE', senderId: null })
      .expect(200);
    await owner
      .post('/api/internal/org-countries')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ countryIso2: 'DE', senderId: null })
      .expect(200);
    const united = await owner
      .post('/api/internal/org-countries')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ countryIso2: 'US', senderId: null })
      .expect(200);
    const overview = await owner.get('/api/internal/senders').expect(200);
    const germany = (
      overview.body.destinations as {
        iso2: string;
        priceSource: string;
        registrationComplete: boolean;
      }[]
    ).find((item) => item.iso2 === 'DE');
    const states = (
      overview.body.destinations as {
        iso2: string;
        registrationComplete: boolean;
        price: { display: string } | null;
      }[]
    ).find((item) => item.iso2 === 'US');
    expect(germany).toMatchObject({ priceSource: 'per-customer', registrationComplete: true });
    expect(states).toMatchObject({ registrationComplete: false, price: null });

    await owner
      .post('/api/internal/sender-ids')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        type: 'ALPHANUMERIC',
        value: 'NOTIFY',
        useCase: 'Delivery notices for customers who opted in.',
        countries: ['US'],
      })
      .expect(400);
    const requested = await owner
      .post('/api/internal/sender-ids')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        type: 'ALPHANUMERIC',
        value: 'NOTIFY',
        useCase: 'Delivery notices for customers who opted in.',
        countries: ['DE'],
      })
      .expect(200);
    await other.get(`/api/internal/sender-ids/${String(requested.body.id)}`).expect(404);
    await other
      .delete(`/api/internal/org-countries/${String(added.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', otherCsrf)
      .expect(404);
    await owner
      .delete(`/api/internal/org-countries/${String(united.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(200);
    const still = await owner.get('/api/internal/senders').expect(200);
    const germanyStill = (still.body.destinations as { iso2: string; enabled: boolean }[]).find(
      (item) => item.iso2 === 'DE',
    );
    expect(germanyStill?.enabled).toBe(true);
  });
});
