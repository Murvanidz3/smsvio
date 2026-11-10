import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { startupFailureMessage } from '@smsvio/shared';
import { Logger } from 'nestjs-pino';

import { loadWorkerEnv } from './env.js';
import { defaultInstanceId } from './heartbeat.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const env = loadWorkerEnv(process.env);
  const app = await NestFactory.createApplicationContext(
    WorkerModule.forRoot(env, defaultInstanceId()),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.init();
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${startupFailureMessage('Worker', error)}\n`);
  process.exit(1);
});
