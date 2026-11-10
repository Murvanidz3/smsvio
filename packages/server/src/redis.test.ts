import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const instances: FakeRedis[] = [];

class FakeRedis extends EventEmitter {
  status = 'ready';
  readonly quit = vi.fn(() => {
    this.status = 'end';
    return Promise.resolve('OK');
  });

  constructor(
    readonly url: string,
    readonly options: Record<string, unknown>,
  ) {
    super();
    instances.push(this);
  }
}

vi.mock('ioredis', () => ({ Redis: FakeRedis }));

const { REDIS, RedisModule, createRedisClient } = await import('./redis.js');

afterEach(() => {
  instances.length = 0;
  vi.restoreAllMocks();
});

describe('createRedisClient', () => {
  it('connects with the given URL and connection name', () => {
    createRedisClient({ url: 'redis://redis:6379', connectionName: 'smsvio-api' });
    expect(instances[0]?.url).toBe('redis://redis:6379');
    expect(instances[0]?.options).toMatchObject({ connectionName: 'smsvio-api' });
  });

  it('logs connection errors instead of crashing', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    createRedisClient({ url: 'redis://redis:6379', connectionName: 'smsvio-api' });
    instances[0]?.emit('error', new Error('ECONNREFUSED'));
    expect(errorSpy).toHaveBeenCalledWith('Redis connection error: ECONNREFUSED');
  });
});

describe('RedisModule', () => {
  async function compile() {
    const moduleRef = await Test.createTestingModule({
      imports: [RedisModule.forRoot({ url: 'redis://redis:6379', connectionName: 'test' })],
    }).compile();
    moduleRef.enableShutdownHooks();
    return moduleRef;
  }

  it('provides the client and quits it on shutdown', async () => {
    const moduleRef = await compile();
    const client = moduleRef.get<FakeRedis>(REDIS);
    expect(client).toBe(instances[0]);
    await moduleRef.close();
    expect(client.quit).toHaveBeenCalledOnce();
  });

  it('does not quit a connection that has already ended', async () => {
    const moduleRef = await compile();
    const client = moduleRef.get<FakeRedis>(REDIS);
    client.status = 'end';
    await moduleRef.close();
    expect(client.quit).not.toHaveBeenCalled();
  });
});
