import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { readinessReportSchema } from '@smsvio/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BODY_LIMIT_BYTES } from './app.factory.js';
import { createFakeDependencies, createTestApp, type FakeDependencies } from './testing.js';

let deps: FakeDependencies;
let app: NestFastifyApplication;

beforeEach(async () => {
  deps = createFakeDependencies();
  app = await createTestApp(deps);
});

afterEach(async () => {
  await app.close();
});

describe('GET /healthz', () => {
  it('returns ok without touching dependencies', async () => {
    const response = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(deps.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(deps.redis.ping).not.toHaveBeenCalled();
  });

  it('is not served under the /api prefix', async () => {
    await request(app.getHttpServer()).get('/api/healthz').expect(404);
  });
});

describe('GET /readyz', () => {
  it('returns 200 when Postgres and Redis respond', async () => {
    const response = await request(app.getHttpServer()).get('/readyz').expect(200);
    const report = readinessReportSchema.parse(response.body);
    expect(report.status).toBe('ok');
    expect(report.checks.postgres?.status).toBe('up');
    expect(report.checks.redis?.status).toBe('up');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 without leaking error details when Redis is down', async () => {
    deps.redis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.3:6379'));
    const response = await request(app.getHttpServer()).get('/readyz').expect(503);
    const report = readinessReportSchema.parse(response.body);
    expect(report.status).toBe('error');
    expect(report.checks.redis?.status).toBe('down');
    expect(report.checks.postgres?.status).toBe('up');
    expect(response.text).not.toContain('ECONNREFUSED');
  });

  it('returns 503 when Postgres does not answer before the timeout', async () => {
    deps.prisma.$queryRaw.mockImplementationOnce(() => new Promise(() => undefined));
    const response = await request(app.getHttpServer()).get('/readyz').expect(503);
    expect(readinessReportSchema.parse(response.body).checks.postgres?.status).toBe('down');
  });

  it('returns 503 without credentials in the body when both dependencies fail', async () => {
    deps.prisma.$queryRaw.mockImplementationOnce(() =>
      Promise.reject(new Error('password authentication failed')),
    );
    deps.redis.ping.mockImplementationOnce(() => Promise.reject(new Error('NOAUTH')));
    const response = await request(app.getHttpServer()).get('/readyz').expect(503);
    expect(response.text).not.toContain('password');
  });
});

describe('request handling', () => {
  it('echoes a valid incoming request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/healthz')
      .set('x-request-id', 'caddy-req-0123456789');
    expect(response.headers['x-request-id']).toBe('caddy-req-0123456789');
  });

  it('generates a request id when none is supplied', async () => {
    const response = await request(app.getHttpServer()).get('/healthz');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/nothing-here').expect(404);
    expect(response.body).toMatchObject({ statusCode: 404 });
  });

  it('rejects bodies over the limit', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/anything')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(BODY_LIMIT_BYTES) }))
      .expect(413);
  });

  it('closes Postgres and Redis on shutdown', async () => {
    await app.close();
    expect(deps.prisma.$disconnect).toHaveBeenCalledOnce();
    expect(deps.redis.quit).toHaveBeenCalledOnce();
    app = await createTestApp(createFakeDependencies());
  });
});
