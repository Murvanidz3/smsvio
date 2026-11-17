import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PRISMA, REDIS } from '@smsvio/server';
import { RATE_LIMITS } from '@smsvio/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApp, createFastifyAdapter } from '../app.factory.js';
import { AppModule } from '../app.module.js';
import { createMemoryDb, createMemoryRedis } from '../memory-db.js';
import { scaledLimit } from '../security/rate-limit.js';
import { testEnv } from '../testing.js';

const SENTINEL = 'upstream-provider-cost-margin-route';

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      keysOf(item, found);
    }
    return found;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      keysOf(child, found);
    }
  }
  return found;
}

describe('GET /api/public/rates', () => {
  const db = createMemoryDb();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    await db.country.create({
      data: {
        iso2: 'DE',
        name: 'Germany',
        dialCode: '49',
        alphaSenderAllowed: false,
        registrationRequired: true,
        notes: SENTINEL,
      },
    });
    await db.country.create({
      data: {
        iso2: 'AE',
        name: 'United Arab Emirates',
        dialCode: '971',
        alphaSenderAllowed: true,
        registrationRequired: false,
      },
    });
    await db.country.create({
      data: {
        iso2: 'ZZ',
        name: 'Hiddenland',
        dialCode: '999',
        alphaSenderAllowed: true,
        registrationRequired: true,
        enabled: false,
        notes: SENTINEL,
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testEnv)] })
      .overrideProvider(PRISMA)
      .useValue(db)
      .overrideProvider(REDIS)
      .useValue(createMemoryRedis())
      .compile();
    app = await configureApp(
      moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(testEnv)),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is public, cacheable, and free of cost or provider data', async () => {
    const server = app.getHttpServer();
    const allowed = scaledLimit(RATE_LIMITS.publicRates.limit);
    const first = await request(server).get('/api/public/rates').expect(200);
    expect(first.headers['cache-control']).toBe('public, max-age=600');
    expect(first.body).toEqual({
      count: 2,
      countries: [
        {
          iso: 'DE',
          name: 'Germany',
          dial_code: '49',
          alpha_sender_allowed: false,
          registration_required: true,
        },
        {
          iso: 'AE',
          name: 'United Arab Emirates',
          dial_code: '971',
          alpha_sender_allowed: true,
          registration_required: false,
        },
      ],
    });
    const names = keysOf(first.body);
    for (const key of [
      'price',
      'price_micros',
      'cost',
      'cost_micros',
      'provider',
      'markup',
      'margin',
      'route',
      'notes',
    ]) {
      expect(names.has(key)).toBe(false);
    }
    expect(JSON.stringify(first.body)).not.toContain(SENTINEL);
    expect(JSON.stringify(first.body)).not.toContain('Hiddenland');

    for (let index = 1; index < allowed; index += 1) {
      await request(server).get('/api/public/rates').expect(200);
    }
    const limited = await request(server).get('/api/public/rates').expect(429);
    expect(limited.body.code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
