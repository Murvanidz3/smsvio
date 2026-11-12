import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PRISMA, REDIS } from '@smsvio/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadWorkerEnv } from './env.js';
import {
  defaultInstanceId,
  HeartbeatService,
  heartbeatKey,
  isHeartbeatFresh,
  STALE_AFTER_INTERVALS,
} from './heartbeat.js';
import { WorkerModule } from './worker.module.js';

function fakeRedis() {
  return {
    status: 'ready',
    set: vi.fn(() => Promise.resolve('OK')),
    del: vi.fn(() => Promise.resolve(1)),
    quit: vi.fn(() => Promise.resolve('OK')),
    lpush: vi.fn(() => Promise.resolve(0)),
    rpop: vi.fn(() => Promise.resolve(null)),
    zadd: vi.fn(() => Promise.resolve(0)),
    zrangebyscore: vi.fn(() => Promise.resolve([])),
    zrem: vi.fn(() => Promise.resolve(0)),
    incr: vi.fn(() => Promise.resolve(1)),
    expire: vi.fn(() => Promise.resolve(1)),
  };
}

const env = loadWorkerEnv({
  LOG_LEVEL: 'silent',
  REDIS_URL: 'redis://redis:6379',
  DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
  WORKER_HEARTBEAT_INTERVAL_MS: '1000',
});

describe('isHeartbeatFresh', () => {
  it.each([
    [null, false],
    ['not-a-number', false],
    [String(10_000), true],
    [String(10_000 - 1000 * STALE_AFTER_INTERVALS), true],
    [String(10_000 - 1000 * STALE_AFTER_INTERVALS - 1), false],
  ])('%j -> %s', (value, fresh) => {
    expect(isHeartbeatFresh(value, 10_000, 1000)).toBe(fresh);
  });
});

describe('heartbeat keys', () => {
  it('namespaces the key per instance', () => {
    expect(heartbeatKey('abc123')).toBe('smsvio:worker:heartbeat:abc123');
  });

  it('uses the host name as the default instance id', () => {
    expect(defaultInstanceId()).toMatch(/.+/);
  });
});

describe('HeartbeatService in the worker module', () => {
  let redis: ReturnType<typeof fakeRedis>;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    redis = fakeRedis();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function start() {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot(env, 'worker-1')],
    })
      .overrideProvider(REDIS)
      .useValue(redis)
      .overrideProvider(PRISMA)
      .useValue({
        orgBalance: { findMany: () => Promise.resolve([]) },
        ledgerEntry: { findMany: () => Promise.resolve([]) },
        message: { findMany: () => Promise.resolve([]) },
        $disconnect: () => Promise.resolve(),
      })
      .compile();
    moduleRef.enableShutdownHooks();
    await moduleRef.init();
    return moduleRef;
  }

  it('beats on start and on every interval with a TTL', async () => {
    const moduleRef = await start();
    expect(redis.set).toHaveBeenCalledWith(
      'smsvio:worker:heartbeat:worker-1',
      '1000000',
      'PX',
      1000 * STALE_AFTER_INTERVALS,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(redis.set).toHaveBeenCalledTimes(4);
    await moduleRef.close();
  });

  it('stops beating and removes its key on shutdown', async () => {
    const moduleRef = await start();
    await moduleRef.close();
    expect(redis.del).toHaveBeenCalledWith('smsvio:worker:heartbeat:worker-1');
    expect(redis.quit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it('logs and survives a failed beat', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    redis.set.mockRejectedValueOnce(new Error('READONLY'));
    const moduleRef = await start();
    expect(errorSpy).toHaveBeenCalledWith('Heartbeat failed: READONLY');
    await vi.advanceTimersByTimeAsync(1000);
    expect(redis.set).toHaveBeenCalledTimes(3);
    await moduleRef.close();
  });

  it('logs when the key cannot be removed on shutdown', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.del.mockRejectedValueOnce(new Error('connection closed'));
    const moduleRef = await start();
    await moduleRef.close();
    expect(warnSpy).toHaveBeenCalledWith(
      'Could not remove heartbeat on shutdown: connection closed',
    );
  });

  it('exposes the service', async () => {
    const moduleRef = await start();
    expect(moduleRef.get(HeartbeatService)).toBeInstanceOf(HeartbeatService);
    await moduleRef.close();
  });
});
