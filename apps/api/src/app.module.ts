import { Global, Module, type DynamicModule } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { createLoggerModule, PrismaModule, RedisModule } from '@smsvio/server';

import { AccountsModule } from './accounts/accounts.module.js';
import { API_ENV } from './config.js';
import type { ApiEnv } from './env.js';
import { HealthController } from './health/health.controller.js';

import './types/fastify.js';

@Global()
@Module({})
class RuntimeModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: RuntimeModule,
      global: true,
      providers: [{ provide: API_ENV, useValue: env }],
      exports: [API_ENV],
    };
  }
}

export const QUIET_PATHS = ['/healthz', '/readyz'] as const;

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeModule.forRoot(env),
        SentryModule.forRoot(),
        createLoggerModule({ service: 'api', level: env.LOG_LEVEL, quietPaths: QUIET_PATHS }),
        PrismaModule.forRoot({
          connectionString: env.DATABASE_URL,
          maxConnections: env.DATABASE_POOL_MAX,
        }),
        RedisModule.forRoot({ url: env.REDIS_URL, connectionName: 'smsvio-api' }),
        AccountsModule,
      ],
      controllers: [HealthController],
    };
  }
}
