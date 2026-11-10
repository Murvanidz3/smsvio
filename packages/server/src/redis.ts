import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

export interface RedisModuleOptions {
  readonly url: string;
  readonly connectionName: string;
}

export function createRedisClient({ url, connectionName }: RedisModuleOptions): Redis {
  const client = new Redis(url, { connectionName, maxRetriesPerRequest: 3 });
  const logger = new Logger('Redis');
  client.on('error', (error: Error) => {
    logger.error(`Redis connection error: ${error.message}`);
  });
  return client;
}

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'end') {
      return;
    }
    await this.redis.quit();
  }
}

@Global()
@Module({})
export class RedisModule {
  static forRoot(options: RedisModuleOptions): DynamicModule {
    return {
      module: RedisModule,
      providers: [{ provide: REDIS, useFactory: () => createRedisClient(options) }, RedisShutdown],
      exports: [REDIS],
    };
  }
}
