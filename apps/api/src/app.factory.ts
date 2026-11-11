import type { IncomingMessage } from 'node:http';

import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { resolveRequestId } from '@smsvio/server';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { API_ENV } from './config.js';
import type { ApiEnv } from './env.js';
import { ApiErrorFilter } from './http/api-error.js';

/** 1 MiB. Larger uploads (documents, CSV) get dedicated limits on their own routes. */
export const BODY_LIMIT_BYTES = 1024 * 1024;

export function createFastifyAdapter(env: Pick<ApiEnv, 'TRUST_PROXY_HOPS'>): FastifyAdapter {
  return new FastifyAdapter({
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (req: IncomingMessage) => resolveRequestId(req.headers['x-request-id']),
  });
}

/** Applies everything main.ts and the tests must share: routing prefix, logger, hooks. */
export async function configureApp(app: NestFastifyApplication): Promise<NestFastifyApplication> {
  await app.register(cookie);
  app.useLogger(app.get(Logger));
  // Nest tries global filters in reverse registration order. SentryGlobalFilter
  // catches every exception, so the API error filter is registered after it.
  app.useGlobalFilters(
    new SentryGlobalFilter(app.getHttpAdapter()),
    new ApiErrorFilter(app.get(API_ENV)),
  );
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'healthz', method: RequestMethod.GET },
      { path: 'readyz', method: RequestMethod.GET },
    ],
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      void reply.header('x-request-id', request.id);
      const path = request.url.split('?')[0] ?? request.url;
      if (path.startsWith('/api/internal')) {
        void reply.header('cache-control', 'no-store');
      }
      done();
    });
  app.enableShutdownHooks();
  return app;
}

export async function createApp(env: ApiEnv): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env),
    createFastifyAdapter(env),
    { bufferLogs: true },
  );
  return configureApp(app);
}
