import { Controller, Get, HttpStatus, Inject, Logger, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PRISMA, REDIS, postgresProbe, redisProbe } from '@smsvio/server';
import type { PrismaClient } from '@smsvio/db';
import {
  checkReadiness,
  errorMessage,
  type DependencyProbe,
  type LivenessReport,
  type ReadinessReport,
} from '@smsvio/shared';
import type { Redis } from 'ioredis';

import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly probes: readonly DependencyProbe[];

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Inject(REDIS) redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.probes = [postgresProbe(prisma), redisProbe(redis)];
  }

  /** Liveness: the process is up and serving HTTP. Never touches dependencies. */
  @Get('healthz')
  liveness(): LivenessReport {
    return { status: 'ok' };
  }

  /** Readiness: Postgres and Redis are reachable. Returns 503 when any dependency is down. */
  @Get('readyz')
  async readiness(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessReport> {
    const { report, failures } = await checkReadiness(this.probes, this.env.READINESS_TIMEOUT_MS);
    for (const failure of failures) {
      this.logger.error(
        `Readiness check failed for ${failure.name}: ${errorMessage(failure.error)}`,
      );
    }
    void reply.header('cache-control', 'no-store');
    if (report.status !== 'ok') {
      void reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
