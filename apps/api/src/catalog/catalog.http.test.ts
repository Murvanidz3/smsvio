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
    .send({ name: 'Catalog Owner', email, password: PASSWORD, organizationName })
    .expect(200);
  const verified = await agent
    .post('/api/internal/auth/verify-email')
    .set('origin', ORIGIN)
    .send({ token: tokenFrom(email) })
    .expect(200);
  capture(verified, who);
  const organization = verified.body.organization as { id?: string };
  if (typeof organization.id !== 'string') {
    throw new Error('missing organization');
  }
  return organization.id;
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
});

afterAll(async () => {
  await app.close();
});

describe('catalog', () => {
  it('manages contacts and templates inside one organization', async () => {
    await request(app.getHttpServer()).get('/api/internal/contacts').expect(401);
    const organizationId = await signUp(owner, 'catalog@example.com', 'Catalog Org', 'owner');
    await signUp(other, 'catalog-other@example.com', 'Other Org', 'other');

    const created = await owner
      .post('/api/internal/contacts')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ phone: '+14155552671', name: 'Ada' })
      .expect(200);
    expect(created.body.phoneE164).toBe('+14155552671');
    expect(created.body.countryCode).toBe('US');

    await owner
      .post('/api/internal/contacts')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ phone: '+1 415 555 2671' })
      .expect(409);

    const imported = await owner
      .post('/api/internal/contacts/import')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        csv: 'phone,name\n+14155552671,Again\n+14155550100,Bea\nnot-a-number,No',
        hasHeader: true,
        phoneColumn: 0,
        nameColumn: 1,
        countryColumn: null,
      })
      .expect(200);
    expect(imported.body.created).toBe(1);
    expect(imported.body.rejected).toHaveLength(2);

    await db.message.create({
      data: {
        organizationId,
        to: '+14155552671',
        body: 'Hello Ada',
        direction: 'OUTBOUND',
        status: 'DELIVERED',
        fromSender: 'SMSVIO',
      },
    });
    const detail = await owner.get(`/api/internal/contacts/${String(created.body.id)}`).expect(200);
    expect(detail.body.messages).toHaveLength(1);
    expect(detail.body.messages[0].status).toBe('delivered');

    await other.get(`/api/internal/contacts/${String(created.body.id)}`).expect(404);
    await other
      .delete(`/api/internal/contacts/${String(created.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', otherCsrf)
      .expect(404);

    const copied = await owner
      .post('/api/internal/templates/gallery')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ id: 'sign-in-code' })
      .expect(200);
    expect(copied.body.status).toBe('DRAFT');

    const pending = await owner
      .post(`/api/internal/templates/${String(copied.body.id)}/submit`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({})
      .expect(200);
    expect(pending.body.status).toBe('PENDING');

    const tooLong = await owner
      .post('/api/internal/templates')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ category: 'UTILITY', language: 'en', body: 'я'.repeat(700) })
      .expect(200);
    await owner
      .post(`/api/internal/templates/${String(tooLong.body.id)}/submit`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({})
      .expect(400);

    await db.message.create({
      data: {
        organizationId,
        templateId: String(copied.body.id),
        to: '+14155552671',
        body: 'Code',
        direction: 'OUTBOUND',
        status: 'DELIVERED',
        fromSender: 'SMSVIO',
      },
    });
    const analytics = await owner
      .get(`/api/internal/templates/${String(copied.body.id)}/analytics?days=7`)
      .expect(200);
    expect(analytics.body.sent).toBe(1);
    expect(analytics.body.delivered).toBe(1);
    expect(analytics.body.points).toHaveLength(7);

    await other.get(`/api/internal/templates/${String(copied.body.id)}`).expect(404);

    await db.country.create({
      data: {
        iso2: 'US',
        name: 'United States',
        dialCode: '1',
        alphaSenderAllowed: false,
        registrationRequired: true,
      },
    });
    const countries = await owner.get('/api/internal/countries').expect(200);
    expect(countries.body.items).toEqual([
      expect.objectContaining({ iso2: 'US', alphaSenderAllowed: false }),
    ]);

    const lookup = await owner
      .post('/api/internal/tools/lookup')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ phone: '+14155552671' })
      .expect(200);
    expect(lookup.body).toMatchObject({
      valid: true,
      e164: '+14155552671',
      countryName: 'United States',
      region: 'Los Angeles',
    });

    const listed = await owner
      .get('/api/internal/contacts?q=ada&country=US&optedOut=no&sort=phone&direction=asc')
      .expect(200);
    expect(listed.body.total).toBeGreaterThan(0);

    await owner
      .post('/api/internal/contacts')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ phone: 'nope', name: '   ' })
      .expect(400);

    const importedAgain = await owner
      .post('/api/internal/contacts/import')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        csv: 'phone,name,city\n+14155550198,Cara,Austin\n+14155550198,Cara again,Austin\n,Missing,X',
        hasHeader: true,
        phoneColumn: 0,
        nameColumn: 1,
        countryColumn: null,
      })
      .expect(200);
    expect(importedAgain.body.created).toBe(1);
    expect(String(importedAgain.body.rejectCsv)).toContain('Duplicate in this file');

    const tagged = await db.contact.create({
      data: {
        organizationId,
        phoneE164: '+14155550197',
        countryCode: 'US',
        name: 'Tagged',
        attributes: { city: 'Austin', count: 1 },
      },
    });
    const taggedBody = await owner.get(`/api/internal/contacts/${tagged.id}`).expect(200);
    expect(taggedBody.body.attributes).toEqual({ city: 'Austin' });

    await owner
      .post('/api/internal/templates/gallery')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ id: 'missing-sample' })
      .expect(404);

    const unnamed = await owner
      .post('/api/internal/templates')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ category: 'MARKETING', language: 'en', body: 'Hello Ada. Reply STOP to opt out.' })
      .expect(200);
    expect(unnamed.body.name).toContain('Hello Ada');

    const updated = await owner
      .patch(`/api/internal/templates/${String(copied.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ category: 'UTILITY', language: 'en', body: 'Updated note for Ada' })
      .expect(200);
    expect(updated.body.status).toBe('DRAFT');

    const duplicate = await owner
      .post(`/api/internal/templates/${String(copied.body.id)}/duplicate`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({})
      .expect(200);
    expect(duplicate.body.name).toContain('Copy of');
    expect(duplicate.body.status).toBe('DRAFT');

    await owner
      .delete(`/api/internal/templates/${String(duplicate.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(200);
    await owner.get(`/api/internal/templates/${String(duplicate.body.id)}`).expect(404);

    await owner.get('/api/internal/templates/gallery').expect(200);
    const filtered = await owner
      .get('/api/internal/templates?q=Updated&status=DRAFT&category=UTILITY')
      .expect(200);
    expect(filtered.body.total).toBeGreaterThan(0);

    await db.message.create({
      data: {
        organizationId,
        templateId: String(copied.body.id),
        to: '+14155552671',
        body: 'Old',
        direction: 'OUTBOUND',
        status: 'FAILED',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });
    await db.message.create({
      data: {
        organizationId,
        templateId: String(copied.body.id),
        to: '+14155552671',
        body: 'Sent',
        direction: 'OUTBOUND',
        status: 'SENT',
      },
    });
    await db.message.create({
      data: {
        organizationId,
        templateId: String(copied.body.id),
        to: '+14155552671',
        body: 'Expired',
        direction: 'OUTBOUND',
        status: 'EXPIRED',
      },
    });
    const wider = await owner
      .get(`/api/internal/templates/${String(copied.body.id)}/analytics?days=30`)
      .expect(200);
    expect(wider.body.sent).toBeGreaterThan(0);
    expect(wider.body.failed).toBe(0);

    await db.template.update({
      where: { id: String(copied.body.id) },
      data: { variables: { name: 'Ada', extra: 1 } },
    });
    const reread = await owner.get(`/api/internal/templates/${String(copied.body.id)}`).expect(200);
    expect(reread.body.samples).toEqual({ name: 'Ada' });

    const invalidLookup = await owner
      .post('/api/internal/tools/lookup')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ phone: '123' })
      .expect(200);
    expect(invalidLookup.body.valid).toBe(false);

    await owner
      .delete(`/api/internal/contacts/${String(created.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(200);
    await owner.get(`/api/internal/contacts/${String(created.body.id)}`).expect(404);
  });
});
