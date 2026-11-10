import 'reflect-metadata';

import { startupFailureMessage } from '@smsvio/shared';

import { createApp } from './app.factory.js';
import { loadApiEnv } from './env.js';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv(process.env);
  const app = await createApp(env);
  await app.listen(env.API_PORT, env.API_HOST);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${startupFailureMessage('API', error)}\n`);
  process.exit(1);
});
