import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { PRISMA, REDIS } from '@smsvio/server';
import { errorMessage } from '@smsvio/shared';
import { ledgerDifferences } from '@smsvio/shared/billing';
import type { Redis } from 'ioredis';

/** One check per UTC day. The lock lives two days so a restart the same day does not repeat it. */
export const LEDGER_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const LOCK_SECONDS = 48 * 60 * 60;

/**
 * Compares stored balances with the ledger. A difference is an error log until an operator
 * alert channel exists. The check never stops the worker.
 */
@Injectable()
export class LedgerSweep implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LedgerSweep.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, LEDGER_SWEEP_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(now = new Date()): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    try {
      const locked = await this.redis.set(
        `smsvio:ledger:sweep:${day}`,
        '1',
        'EX',
        LOCK_SECONDS,
        'NX',
      );
      if (locked !== 'OK') {
        return;
      }
      const [balances, entries] = await Promise.all([
        this.prisma.orgBalance.findMany(),
        this.prisma.ledgerEntry.findMany(),
      ]);
      const differences = ledgerDifferences(
        balances.map((row) => ({
          organizationId: row.organizationId,
          availableMicros: row.availableMicros,
          heldMicros: row.heldMicros,
        })),
        entries.map((row) => ({
          organizationId: row.organizationId,
          type: row.type,
          amountMicros: row.amountMicros,
          refId: row.refId,
        })),
      );
      for (const row of differences) {
        this.logger.error(
          `Ledger difference for ${row.organizationId}: available ${row.availableMicros.toString()} stored vs ${row.ledgerAvailableMicros.toString()} ledger, held ${row.heldMicros.toString()} stored vs ${row.ledgerHeldMicros.toString()} ledger`,
        );
      }
    } catch (error) {
      this.logger.error(`Ledger sweep failed: ${errorMessage(error)}`);
    }
  }
}
