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
});

afterAll(async () => {
  await app.close();
});

describe('compliance and the operator queue', () => {
  it('submits verification, keeps protected replies, and lets an admin approve', async () => {
    await owner
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send({
        name: 'Ada',
        email: 'compliance-owner@example.com',
        password: PASSWORD,
        organizationName: 'Compliance Org',
      })
      .expect(200);
    const verified = await owner
      .post('/api/internal/auth/verify-email')
      .set('origin', ORIGIN)
      .send({ token: tokenFrom('compliance-owner@example.com') })
      .expect(200);
    capture(verified);
    const organizationId = verified.body.organization.id as string;

    const view = await owner.get('/api/internal/compliance').expect(200);
    expect(view.body.replies).toHaveLength(3);
    const protectedReply = (view.body.replies as { id: string; protected: boolean }[]).find(
      (reply) => reply.protected,
    );
    if (protectedReply === undefined) {
      throw new Error('missing default reply');
    }
    await owner
      .delete(`/api/internal/compliance/replies/${protectedReply.id}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(400);
    await owner
      .post('/api/internal/compliance/business')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ legalName: 'Ada LLC', address: '1 Main Street', registrationCountry: 'GE' })
      .expect(201);
    await owner
      .post('/api/internal/compliance/business')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ legalName: 'Ada LLC', address: '1 Main Street', registrationCountry: 'GE' })
      .expect(409);
    const useCase = await owner
      .post('/api/internal/compliance/use-cases')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        purpose: 'Order updates for customers who opted in at checkout.',
        sample: 'Your order has shipped.',
        optIn: 'Customers tick a box during checkout.',
      })
      .expect(201);
    const reply = await owner
      .post('/api/internal/compliance/replies')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ category: 'CUSTOM', keywords: ['hours'], body: 'We are open 9 to 5.' })
      .expect(201);
    await owner
      .patch(`/api/internal/compliance/replies/${String(reply.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ category: 'CUSTOM', keywords: ['hours'], body: 'We are open 9 to 6.' })
      .expect(200);
    const document = await owner
      .post('/api/internal/compliance/documents')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        countryIso2: 'GE',
        kind: 'license',
        filename: 'note.txt',
        contentType: 'text/plain',
        dataBase64: Buffer.from('license').toString('base64'),
      })
      .expect(201);
    await owner
      .post('/api/internal/compliance/documents')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        countryIso2: 'GE',
        kind: 'license',
        filename: 'fake.png',
        contentType: 'image/png',
        dataBase64: Buffer.from('not a png').toString('base64'),
      })
      .expect(400);
    const downloaded = await owner
      .get(`/api/internal/compliance/documents/${String(document.body.id)}`)
      .expect(200);
    expect(downloaded.headers['content-type']).toContain('text/plain');
    await owner
      .delete(`/api/internal/compliance/replies/${String(reply.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(200);
    await owner
      .post('/api/internal/compliance/replies')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ category: 'HELP', keywords: ['assist'], body: 'Help text.' })
      .expect(400);
    await owner
      .post('/api/internal/compliance/replies')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ category: 'CUSTOM', keywords: ['stop'], body: 'Already used.' })
      .expect(400);
    await owner
      .delete('/api/internal/compliance/replies/00000000-0000-4000-8000-000000000000')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .expect(404);

    const user = await db.user.findUnique({ where: { email: 'compliance-owner@example.com' } });
    if (user === null) {
      throw new Error('missing user');
    }
    await db.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
    const reviews = await owner.get('/api/internal/admin/reviews').expect(200);
    expect(reviews.body.verification).toHaveLength(1);
    expect(reviews.body.useCases).toHaveLength(1);
    await owner
      .post(`/api/internal/admin/reviews/verification/${organizationId}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ decision: 'reject', note: 'Add the registration number.' })
      .expect(201);
    await owner
      .get('/api/internal/admin/reviews')
      .expect(200)
      .expect((response) => {
        expect(response.body.verification).toHaveLength(0);
      });
    await owner
      .post('/api/internal/compliance/business')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        legalName: 'Ada LLC',
        address: '1 Main Street',
        registrationNumber: '123',
        registrationCountry: 'GE',
      })
      .expect(201);
    await owner
      .post('/api/internal/compliance/business')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ legalName: 'Ada LLC', address: '1 Main Street', registrationCountry: 'GE' })
      .expect(409);
    await owner
      .post(`/api/internal/admin/reviews/use-cases/${String(useCase.body.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ decision: 'approve', note: 'Looks fine' })
      .expect(201);
    await owner
      .post(`/api/internal/admin/reviews/verification/${organizationId}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ decision: 'approve' })
      .expect(201);
    const sender = await db.senderId.create({
      data: { organizationId, type: 'ALPHANUMERIC', value: 'ADA', useCase: 'Orders' },
    });
    const template = await db.template.create({
      data: {
        organizationId,
        createdById: user.id,
        name: 'Shipped',
        category: 'UTILITY',
        language: 'en',
        body: 'Your order shipped.',
        variables: [],
        status: 'PENDING',
      },
    });
    await owner
      .post(`/api/internal/admin/reviews/senders/${sender.id}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ decision: 'reject', note: 'Need a sample.' })
      .expect(201);
    await owner
      .post(`/api/internal/admin/reviews/templates/${template.id}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ decision: 'approve' })
      .expect(201);
    const health = await owner.get('/api/internal/admin/health').expect(200);
    expect(health.body.queues.send).toBe(0);
    expect(health.body.stuck).toEqual([]);
    expect(health.body.errorGroups).toEqual([]);
    const operations = await owner.get('/api/internal/admin/operations').expect(200);
    expect(operations.body.paused).toBe(false);
    expect(operations.body.today.total).toEqual(expect.any(Number));
    await owner
      .post('/api/internal/admin/sending')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ paused: true })
      .expect(201);
    const paused = await owner.get('/api/internal/admin/operations').expect(200);
    expect(paused.body.paused).toBe(true);
    await owner
      .post('/api/internal/admin/sending')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ paused: false })
      .expect(201);
    const statistics = await owner.get('/api/internal/admin/statistics').expect(200);
    expect(statistics.body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(statistics.body.byRoute).toEqual(expect.any(Array));
    expect(statistics.body.byOrganization).toEqual(expect.any(Array));
    await owner.get('/api/internal/admin/messages?status=FAILED&errorCode=no_route').expect(200);
    const margin = await owner.get('/api/internal/admin/margin').expect(200);
    expect(margin.body.items).toEqual([]);
    await owner.get('/api/internal/admin/messages?q=4915').expect(200);
    const audit = await owner.get('/api/internal/admin/audit').expect(200);
    expect(audit.body.total).toBeGreaterThan(0);
    const exported = await owner.get('/api/internal/organization/export').expect(200);
    expect(exported.headers['content-disposition']).toContain('smsvio-export.json');
    expect(exported.body.organization.name).toBe('Compliance Org');
    expect(exported.body.messagesTruncated).toBe(false);

    await db.optOut.upsert({
      where: { organizationId_phoneE164: { organizationId, phoneE164: '+4915123456789' } },
      create: { organizationId, phoneE164: '+4915123456789', source: 'keyword' },
      update: { source: 'keyword' },
    });
    await db.user.update({ where: { id: user.id }, data: { isPlatformAdmin: false } });
  });
});
