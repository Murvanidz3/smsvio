import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PRISMA, REDIS } from '@smsvio/server';
import { vi } from 'vitest';

import { configureApp, createFastifyAdapter } from './app.factory.js';
import { AppModule } from './app.module.js';
import { loadApiEnv, type ApiEnv } from './env.js';

export const testEnv: ApiEnv = loadApiEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
  REDIS_URL: 'redis://:pw@redis:6379',
  READINESS_TIMEOUT_MS: '200',
});

export function createFakeDependencies() {
  return {
    prisma: {
      $queryRaw: vi.fn(() => Promise.resolve([{ '?column?': 1 }])),
      $disconnect: vi.fn(() => Promise.resolve()),
    },
    redis: {
      status: 'ready',
      ping: vi.fn(() => Promise.resolve('PONG')),
      quit: vi.fn(() => Promise.resolve('OK')),
    },
  };
}

export type FakeDependencies = ReturnType<typeof createFakeDependencies>;

/** Boots the real application module with Postgres and Redis replaced by fakes. */
export async function createTestApp(deps: FakeDependencies): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testEnv)] })
    .overrideProvider(PRISMA)
    .useValue(deps.prisma)
    .overrideProvider(REDIS)
    .useValue(deps.redis)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(testEnv)),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
