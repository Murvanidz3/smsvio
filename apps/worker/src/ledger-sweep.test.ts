import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LEDGER_SWEEP_INTERVAL_MS, LedgerSweep } from './ledger-sweep.js';

function harness() {
  const prisma = {
    orgBalance: {
      findMany: vi.fn(
        (): Promise<{ organizationId: string; availableMicros: bigint; heldMicros: bigint }[]> =>
          Promise.resolve([]),
      ),
    },
    ledgerEntry: {
      findMany: vi.fn(
        (): Promise<
          { organizationId: string; type: string; amountMicros: bigint; refId: string | null }[]
        > => Promise.resolve([]),
      ),
    },
  };
  const redis = { set: vi.fn((): Promise<'OK' | null> => Promise.resolve('OK')) };
  const service = new LedgerSweep(prisma as never, redis as never);
  return { prisma, redis, service };
}

describe('LedgerSweep', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks once per UTC day', async () => {
    const { prisma, redis, service } = harness();
    await service.runOnce(new Date('2026-11-11T01:00:00.000Z'));
    expect(redis.set).toHaveBeenCalledWith(
      'smsvio:ledger:sweep:2026-11-11',
      '1',
      'EX',
      172800,
      'NX',
    );
    expect(prisma.orgBalance.findMany).toHaveBeenCalledOnce();
    redis.set.mockResolvedValueOnce(null);
    await service.runOnce(new Date('2026-11-11T02:00:00.000Z'));
    expect(prisma.orgBalance.findMany).toHaveBeenCalledOnce();
  });

  it('logs a stored balance that does not match the ledger', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { prisma, service } = harness();
    prisma.orgBalance.findMany.mockResolvedValueOnce([
      { organizationId: 'org', availableMicros: 1n, heldMicros: 0n },
    ]);
    prisma.ledgerEntry.findMany.mockResolvedValueOnce([
      { organizationId: 'org', type: 'ADJUSTMENT', amountMicros: 2n, refId: null },
    ]);
    await service.runOnce(new Date('2026-11-11T00:00:00.000Z'));
    expect(errorSpy).toHaveBeenCalledWith(
      'Ledger difference for org: available 1 stored vs 2 ledger, held 0 stored vs 0 ledger',
    );
  });

  it('logs and continues when the check cannot read the database', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { redis, service } = harness();
    redis.set.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.runOnce()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('Ledger sweep failed: redis down');
  });

  it('stops scheduling after shutdown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { redis, service } = harness();
    service.onApplicationBootstrap();
    await vi.waitFor(() => {
      expect(redis.set).toHaveBeenCalledOnce();
    });
    await vi.advanceTimersByTimeAsync(LEDGER_SWEEP_INTERVAL_MS);
    await vi.waitFor(() => {
      expect(redis.set).toHaveBeenCalledTimes(2);
    });
    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(LEDGER_SWEEP_INTERVAL_MS);
    expect(redis.set).toHaveBeenCalledTimes(2);
  });
});
