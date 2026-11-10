import { Module, type DynamicModule } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { createLoggerModule, RedisModule } from '@smsvio/server';

import type { WorkerEnv } from './env.js';
import { HEARTBEAT_SETTINGS, HeartbeatService, type HeartbeatSettings } from './heartbeat.js';

@Module({})
export class WorkerModule {
  static forRoot(env: WorkerEnv, instanceId: string): DynamicModule {
    const heartbeat: HeartbeatSettings = {
      intervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS,
      instanceId,
    };
    return {
      module: WorkerModule,
      imports: [
        SentryModule.forRoot(),
        createLoggerModule({ service: 'worker', level: env.LOG_LEVEL }),
        RedisModule.forRoot({ url: env.REDIS_URL, connectionName: 'smsvio-worker' }),
      ],
      providers: [{ provide: HEARTBEAT_SETTINGS, useValue: heartbeat }, HeartbeatService],
    };
  }
}
