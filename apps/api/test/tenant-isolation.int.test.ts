import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request, { type Agent, type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.factory.js';
import { loadApiEnv } from '../src/env.js';

const ORIGIN = 'http://127.0.0.1:4000';
const PASSWORD = 'smsvio-phase1-pass';
const mailDir = mkdtempSync(join(tmpdir(), 'smsvio-int-'));
const tokenPattern = /token=([A-Za-z0-9_-]+)/;

let app: NestFastifyApplication;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected an object response.');
  }
  return value as Record<string, unknown>;
}

function csrfFrom(response: Response): string {
  const header = response.headers['set-cookie'];
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const line = lines.find((entry) => entry.startsWith('smsvio_csrf='));
  return decodeURIComponent(line?.split(';')[0]?.slice('smsvio_csrf='.length) ?? '');
}

function tokenFor(email: string): string {
  for (const file of readdirSync(mailDir)) {
    const raw = readFileSync(join(mailDir, file), 'utf8');
    if (raw.includes(email)) {
      return tokenPattern.exec(raw)?.[1] ?? '';
    }
  }
  return '';
}

async function openAccount(
  email: string,
  organizationName: string,
): Promise<{ agent: Agent; csrf: string; organizationId: string }> {
  const server = app.getHttpServer();
  await request(server)
    .post('/api/internal/auth/signup')
    .set('origin', ORIGIN)
    .send({ name: 'Isolation Owner', email, password: PASSWORD, organizationName })
    .expect(200);
  const token = tokenFor(email);
  expect(token).not.toBe('');
  const agent = request.agent(server);
  const verified = await agent
    .post('/api/internal/auth/verify-email')
    .set('origin', ORIGIN)
    .send({ token })
    .expect(200);
  const organization = record(record(verified.body).organization);
  const organizationId = organization.id;
  if (typeof organizationId !== 'string') {
    throw new Error('Verified session did not include an organization.');
  }
  return { agent, csrf: csrfFrom(verified), organizationId };
}

beforeAll(async () => {
  app = await createApp(
    loadApiEnv({
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      EMAIL_MODE: 'smtp',
      PUBLIC_ORIGIN: ORIGIN,
      APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY ?? 'ab'.repeat(32),
      SMTP_HOST: '127.0.0.1',
      SMTP_FROM: 'SMSVIO <noreply@smsvio.test>',
      MAIL_SINK_DIR: mailDir,
      TRUST_PROXY_HOPS: '0',
    }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe('tenant isolation against Postgres', () => {
  it('hides another organization and its members', async () => {
    const stamp = Date.now().toString(36);
    const ada = await openAccount(`ada-${stamp}@example.com`, `Ada ${stamp}`);
    const bea = await openAccount(`bea-${stamp}@example.com`, `Bea ${stamp}`);

    await bea.agent
      .post('/api/internal/organization/switch')
      .set('origin', ORIGIN)
      .set('x-csrf-token', bea.csrf)
      .send({ organizationId: ada.organizationId })
      .expect(404);

    const directory = await ada.agent
      .get('/api/internal/members')
      .set('origin', ORIGIN)
      .expect(200);
    const items = record(directory.body).items;
    const first = Array.isArray(items) ? record(items[0]) : {};
    expect(typeof first.id).toBe('string');

    await bea.agent
      .patch(`/api/internal/members/${String(first.id)}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', bea.csrf)
      .send({ role: 'ADMIN' })
      .expect(404);

    const adaStill = await ada.agent.get('/api/internal/session').expect(200);
    expect(record(record(adaStill.body).organization).id).toBe(ada.organizationId);

    await ada.agent
      .post('/api/internal/organization/delete')
      .set('origin', ORIGIN)
      .set('x-csrf-token', ada.csrf)
      .send({ confirmName: `Ada ${stamp}` })
      .expect(200);
    await bea.agent
      .post('/api/internal/organization/delete')
      .set('origin', ORIGIN)
      .set('x-csrf-token', bea.csrf)
      .send({ confirmName: `Bea ${stamp}` })
      .expect(200);
  });
});
