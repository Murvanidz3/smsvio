import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { readinessReportSchema } from '@smsvio/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.factory.js';
import { loadApiEnv } from '../src/env.js';

// Runs against real Postgres and Redis (CI service containers or the local compose stack).
// DATABASE_URL and REDIS_URL must be set; loadApiEnv fails fast with a clear message otherwise.
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApp(loadApiEnv({ ...process.env, LOG_LEVEL: 'silent' }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe('health endpoints against real dependencies', () => {
  it('GET /healthz is live', async () => {
    const response = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /readyz reports Postgres and Redis up', async () => {
    const response = await request(app.getHttpServer()).get('/readyz').expect(200);
    const report = readinessReportSchema.parse(response.body);
    expect(report).toMatchObject({
      status: 'ok',
      checks: { postgres: { status: 'up' }, redis: { status: 'up' } },
    });
  });
});
