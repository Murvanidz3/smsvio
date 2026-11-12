import { Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { PRISMA, REDIS } from '@smsvio/server';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

import { acceptProviderCallback } from './provider-hook.js';

@Controller('hooks/providers')
export class ProviderHooksController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Post(':code')
  @HttpCode(204)
  async receive(@Param() params: { code?: string }, @Req() request: FastifyRequest): Promise<void> {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value;
    }
    await acceptProviderCallback(this.prisma, this.redis, params.code ?? '', {
      headers,
      body: request.body,
    });
  }
}
