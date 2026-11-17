import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { errorMessage } from '@smsvio/shared';
import { USAGE_REFRESH_MS } from '@smsvio/shared/billing';
import { PRISMA } from '@smsvio/server';
import nodemailer from 'nodemailer';

import { WORKER_ENV, type WorkerEnv } from './env.js';
import { notifyLowBalances, refreshUsage, type UsageMail } from './usage-pass.js';

/** Stores daily usage and sends low-balance notices. A pass that is still running is left to finish. */
@Injectable()
export class UsageLoop implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UsageLoop.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, USAGE_REFRESH_MS);
    void this.tick();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await refreshUsage(this.prisma);
      await notifyLowBalances(this.prisma, this.env, mailer(this.env), (message) => {
        this.logger.warn(message);
      });
    } catch (error) {
      this.logger.error(`Usage pass failed: ${errorMessage(error)}`);
    } finally {
      this.running = false;
    }
  }
}

function mailer(env: WorkerEnv): UsageMail {
  return {
    send: async (message) => {
      if (env.SMTP_HOST === undefined || env.SMTP_FROM === undefined) {
        return;
      }
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth:
          env.SMTP_USER === undefined || env.SMTP_PASSWORD === undefined
            ? undefined
            : { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      });
      await transport.sendMail({
        from: env.SMTP_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
