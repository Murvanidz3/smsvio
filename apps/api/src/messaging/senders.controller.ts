import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { idParamSchema } from '@smsvio/shared';
import { addCountrySchema, requestSenderSchema } from '@smsvio/shared/billing';
import type { FastifyRequest } from 'fastify';

import type { AuthState } from '../accounts/support.js';
import { SessionGuard } from '../accounts/guards.js';
import { clientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { parseInput } from '../http/parse.js';
import { SenderService } from './senders.service.js';

@Controller('internal')
@UseGuards(SessionGuard)
export class SendersController {
  constructor(private readonly senders: SenderService) {}

  @Get('senders')
  overview(@Req() request: FastifyRequest) {
    return this.senders.overview(current(request));
  }

  @Post('org-countries')
  @HttpCode(200)
  addCountry(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.senders.addCountry(
      current(request),
      parseInput(addCountrySchema, body),
      clientInfo(request),
    );
  }

  @Delete('org-countries/:id')
  @HttpCode(200)
  removeCountry(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.senders.removeCountry(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Post('sender-ids')
  @HttpCode(200)
  requestSender(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.senders.requestSender(
      current(request),
      parseInput(requestSenderSchema, body),
      clientInfo(request),
    );
  }

  @Get('sender-ids/:id')
  getSender(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.senders.getSender(current(request), parseInput(idParamSchema, params).id);
  }
}

function current(request: FastifyRequest): AuthState {
  if (request.auth === undefined) {
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }
  return request.auth;
}
