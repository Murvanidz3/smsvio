import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { errorMessage } from '@smsvio/shared';
import { PRISMA, REDIS } from '@smsvio/server';
import type { Redis } from 'ioredis';

import { runSendTick } from './dispatch.js';

const TICK_MS = 200;

/** Drains the send queue. A tick that is still running is left to finish. */
@Injectable()
export class SendLoop implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SendLoop.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await runSendTick(this.prisma, this.redis, now);
    } catch (error) {
      this.logger.error(`Send tick failed: ${errorMessage(error)}`);
    } finally {
      this.running = false;
    }
  }
}
