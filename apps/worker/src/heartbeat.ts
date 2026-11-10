import { hostname } from 'node:os';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { REDIS } from '@smsvio/server';
import { errorMessage } from '@smsvio/shared';
import type { Redis } from 'ioredis';

export interface HeartbeatSettings {
  readonly intervalMs: number;
  readonly instanceId: string;
}

export const HEARTBEAT_SETTINGS = Symbol('HEARTBEAT_SETTINGS');

/** A heartbeat older than this many intervals means the worker is stuck or gone. */
export const STALE_AFTER_INTERVALS = 3;

export function heartbeatKey(instanceId: string): string {
  return `smsvio:worker:heartbeat:${instanceId}`;
}

export function defaultInstanceId(): string {
  return hostname();
}

export function isHeartbeatFresh(value: string | null, nowMs: number, intervalMs: number): boolean {
  if (value === null) {
    return false;
  }
  const beatAt = Number(value);
  if (!Number.isFinite(beatAt)) {
    return false;
  }
  return nowMs - beatAt <= intervalMs * STALE_AFTER_INTERVALS;
}

/** Publishes a timestamp to Redis so the container health check can tell the worker is alive. */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HeartbeatService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(HEARTBEAT_SETTINGS) private readonly settings: HeartbeatSettings,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => {
      void this.beat();
    }, this.settings.intervalMs);
    this.logger.log(`Worker ${this.settings.instanceId} started`);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    try {
      await this.redis.del(heartbeatKey(this.settings.instanceId));
    } catch (error) {
      this.logger.warn(`Could not remove heartbeat on shutdown: ${errorMessage(error)}`);
    }
  }

  async beat(): Promise<void> {
    const ttlMs = this.settings.intervalMs * STALE_AFTER_INTERVALS;
    try {
      await this.redis.set(heartbeatKey(this.settings.instanceId), String(Date.now()), 'PX', ttlMs);
    } catch (error) {
      this.logger.error(`Heartbeat failed: ${errorMessage(error)}`);
    }
  }
}
