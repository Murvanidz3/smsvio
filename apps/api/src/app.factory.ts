import type { IncomingMessage } from 'node:http';

import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { resolveRequestId } from '@smsvio/server';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import type { ApiEnv } from './env.js';

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
export function configureApp(app: NestFastifyApplication): NestFastifyApplication {
  app.useLogger(app.get(Logger));
  // SentryGlobalFilter ships without decorator metadata, so it gets the HTTP adapter explicitly.
  app.useGlobalFilters(new SentryGlobalFilter(app.getHttpAdapter()));
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
