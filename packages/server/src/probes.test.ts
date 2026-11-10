import { describe, expect, it, vi } from 'vitest';

import { postgresProbe, redisProbe } from './probes.js';

describe('postgresProbe', () => {
  it('runs SELECT 1', async () => {
    const queryRaw = vi.fn((strings: TemplateStringsArray) => Promise.resolve(strings.join('')));
    const probe = postgresProbe({ $queryRaw: queryRaw } as never);
    expect(probe.name).toBe('postgres');
    await probe.check();
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(queryRaw.mock.calls[0]?.[0].join('')).toBe('SELECT 1');
  });

  it('propagates database errors', async () => {
    const probe = postgresProbe({ $queryRaw: () => Promise.reject(new Error('down')) } as never);
    await expect(probe.check()).rejects.toThrow('down');
  });
});

describe('redisProbe', () => {
  it('succeeds on PONG', async () => {
    const probe = redisProbe({ ping: () => Promise.resolve('PONG') } as never);
    expect(probe.name).toBe('redis');
    await expect(probe.check()).resolves.toBeUndefined();
  });

  it('propagates error replies', async () => {
    const ping = vi.fn(() => Promise.reject(new Error('NOAUTH')));
    const probe = redisProbe({ ping });
    await expect(probe.check()).rejects.toThrow('NOAUTH');
  });
});
