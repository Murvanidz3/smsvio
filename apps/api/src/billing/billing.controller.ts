import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { idParamSchema } from '@smsvio/shared';
import {
  billingHistoryQuerySchema,
  billingPreferencesSchema,
  overviewQuerySchema,
  topUpSchema,
} from '@smsvio/shared/billing';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuthState } from '../accounts/support.js';
import { SessionGuard } from '../accounts/guards.js';
import { clientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { firstQueryValues, parseInput } from '../http/parse.js';
import { BillingService } from './billing.service.js';

@Controller('internal')
@UseGuards(SessionGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('overview')
  overview(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.billing.overview(
      current(request),
      parseInput(overviewQuerySchema, firstQueryValues(query)),
    );
  }

  @Get('billing')
  view(@Req() request: FastifyRequest) {
    return this.billing.billing(current(request));
  }

  @Patch('billing')
  update(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.billing.updatePreferences(
      current(request),
      parseInput(billingPreferencesSchema, body),
      clientInfo(request),
    );
  }

  @Get('billing/entries')
  history(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.billing.history(
      current(request),
      parseInput(billingHistoryQuerySchema, firstQueryValues(query)),
    );
  }

  @Get('billing/entries/:id/receipt')
  async receipt(
    @Req() request: FastifyRequest,
    @Param() params: unknown,
    @Res() reply: FastifyReply,
  ) {
    const id = parseInput(idParamSchema, params).id;
    const text = await this.billing.receipt(current(request), id);
    await reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="receipt-${id}.txt"`)
      .send(text);
  }

  @Post('billing/top-ups')
  topUp(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.billing.requestTopUp(current(request), parseInput(topUpSchema, body).amount);
  }

  @Get('pricing/rates')
  rates(@Req() request: FastifyRequest) {
    return this.billing.rates(current(request));
  }
}

function current(request: FastifyRequest): AuthState {
  if (request.auth === undefined) {
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }
  return request.auth;
}
