import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { REDIS } from '@smsvio/server';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';

import { readMessageExport } from './messages.service.js';
import { notFound } from './present.js';

/** Download link from an emailed message export. The token is the secret. */
@Controller('exports')
export class ExportsController {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  @Get(':token')
  async download(@Param() params: { token?: string }, @Res() reply: FastifyReply): Promise<void> {
    const csv = await readMessageExport(this.redis, params.token ?? '');
    if (csv === null) {
      throw notFound();
    }
    await reply
      .status(200)
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="messages.csv"')
      .send(csv);
  }
}
