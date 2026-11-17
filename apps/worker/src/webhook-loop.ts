import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { errorMessage } from '@smsvio/shared';
import { decryptString } from '@smsvio/shared/developer';
import { PRISMA, REDIS } from '@smsvio/server';
import type { Redis } from 'ioredis';
import nodemailer from 'nodemailer';

import { WORKER_ENV, type WorkerEnv } from './env.js';
import { postWebhook } from './webhook-post.js';
import { runWebhookTick } from './webhook-deliver.js';

const TICK_MS = 500;

/** Drains webhook deliveries. A tick that is still running is left to finish. */
@Injectable()
export class WebhookLoop implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WebhookLoop.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
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
      await runWebhookTick(this.prisma, this.redis, {
        now,
        decrypt: (payload) => decryptString(payload, this.env.APP_ENCRYPTION_KEY),
        post: postWebhook,
        notify: (endpoint) =>
          notifyOwners(this.prisma, this.env, endpoint, (message) => {
            this.logger.warn(message);
          }),
      });
    } catch (error) {
      this.logger.error(`Webhook tick failed: ${errorMessage(error)}`);
    } finally {
      this.running = false;
    }
  }
}

export async function notifyOwners(
  prisma: PrismaClient,
  env: WorkerEnv,
  endpoint: { organizationId: string; name: string; url: string },
  log: (message: string) => void,
): Promise<void> {
  if (env.EMAIL_MODE !== 'smtp' || env.SMTP_HOST === undefined || env.SMTP_FROM === undefined) {
    log(
      `Webhook ${endpoint.name} was disabled. Email is not configured, so the owners were not mailed.`,
    );
    return;
  }
  const members = await prisma.membership.findMany({
    where: {
      organizationId: endpoint.organizationId,
      role: { in: ['OWNER', 'ADMIN'] },
      status: 'ACTIVE',
    },
    select: { user: { select: { email: true } } },
  });
  const origin = env.PUBLIC_ORIGIN ?? 'https://smsvio.com';
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER === undefined || env.SMTP_PASSWORD === undefined
        ? undefined
        : { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  const text = `The webhook ${endpoint.name} at ${endpoint.url} was disabled after deliveries failed for about 24 hours. Open ${origin}/dashboard/webhooks to enable it again.`;
  for (const member of members) {
    await transport.sendMail({
      from: env.SMTP_FROM,
      to: member.user.email,
      subject: 'SMSVIO webhook disabled',
      text,
    });
  }
}
