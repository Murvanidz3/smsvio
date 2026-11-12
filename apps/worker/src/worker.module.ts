import { Module, type DynamicModule } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { createLoggerModule, PrismaModule, RedisModule } from '@smsvio/server';

import type { WorkerEnv } from './env.js';
import { HEARTBEAT_SETTINGS, HeartbeatService, type HeartbeatSettings } from './heartbeat.js';
import { LedgerSweep } from './ledger-sweep.js';
import { SendLoop } from './send-loop.js';

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
        PrismaModule.forRoot({
          connectionString: env.DATABASE_URL,
          maxConnections: env.DATABASE_POOL_MAX,
        }),
      ],
      providers: [
        { provide: HEARTBEAT_SETTINGS, useValue: heartbeat },
        HeartbeatService,
        LedgerSweep,
        SendLoop,
      ],
    };
  }
}
