import type { PrismaClient } from '@smsvio/db';
import type { DependencyProbe } from '@smsvio/shared';
import type { Redis } from 'ioredis';

export function postgresProbe(prisma: Pick<PrismaClient, '$queryRaw'>): DependencyProbe {
  return {
    name: 'postgres',
    check: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  };
}

export function redisProbe(redis: Pick<Redis, 'ping'>): DependencyProbe {
  return {
    name: 'redis',
    // ioredis rejects on error replies such as NOAUTH or LOADING.
    check: async () => {
      await redis.ping();
    },
  };
}
