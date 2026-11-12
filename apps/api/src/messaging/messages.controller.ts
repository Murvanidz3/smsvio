import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { idParamSchema, messageListSchema, sendMessageSchema } from '@smsvio/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { from, interval, map, switchMap } from 'rxjs';

import type { AuthState } from '../accounts/support.js';
import { SessionGuard } from '../accounts/guards.js';
import { ApiError } from '../http/api-error.js';
import { firstQueryValues, parseInput } from '../http/parse.js';
import { MessageQueryService } from './messages.service.js';
import { SendService } from './send.service.js';

@Controller('internal')
@UseGuards(SessionGuard)
export class MessagesController {
  constructor(
    private readonly sendService: SendService,
    private readonly messages: MessageQueryService,
  ) {}

  @Post('messages/preview')
  @HttpCode(200)
  preview(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.sendService.preview(current(request), parseInput(sendMessageSchema, body));
  }

  @Post('messages')
  @HttpCode(202)
  send(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = parseInput(sendMessageSchema, body);
    const key = idempotencyKey(request);
    return this.sendService.send(current(request), {
      ...parsed,
      ...(key === undefined ? {} : { clientRef: key }),
    });
  }

  @Sse('messages/stream')
  stream(@Req() request: FastifyRequest, @Query() query: { ids?: string | string[] }) {
    const raw = Array.isArray(query.ids) ? query.ids.join(',') : (query.ids ?? '');
    const ids = raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
    const state = current(request);
    return interval(1000).pipe(
      switchMap(() => from(this.messages.activity(state, ids))),
      map((rows) => ({ data: rows })),
    );
  }

  @Get('messages/export')
  async export(
    @Req() request: FastifyRequest,
    @Query() query: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.messages.export(
      current(request),
      parseInput(messageListSchema, firstQueryValues(query)),
    );
    if (result.kind === 'queued') {
      await reply.status(202).send({ message: result.message });
      return;
    }
    await reply
      .status(200)
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="messages.csv"')
      .send(result.body);
  }

  @Get('messages')
  list(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.messages.list(
      current(request),
      parseInput(messageListSchema, firstQueryValues(query)),
    );
  }

  @Get('messages/:id')
  get(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.messages.get(current(request), parseInput(idParamSchema, params).id);
  }
}

function current(request: FastifyRequest): AuthState {
  if (request.auth === undefined) {
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }
  return request.auth;
}

function idempotencyKey(request: FastifyRequest): string | undefined {
  const header = request.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const key = value.trim();
  if (key.length > 80) {
    throw new ApiError(400, 'validation_error', 'The idempotency key is too long.');
  }
  return key;
}
