import { Controller, HttpCode, Inject, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { REDIS } from '@smsvio/server';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { acceptSentDmWebhook } from './sent-dm-hook.js';

/** Sent.dm delivery events. Register https://<host>/api/hooks/sent-dm in the Sent dashboard. */
@Controller('hooks/sent-dm')
export class SentDmHooksController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Post()
  @HttpCode(204)
  async receive(@Req() request: RawBodyRequest<FastifyRequest>): Promise<void> {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value;
    }
    await acceptSentDmWebhook(this.redis, this.env.SENT_DM_WEBHOOK_SECRET, {
      headers,
      rawBody: request.rawBody?.toString('utf8'),
    });
  }
}
