import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { idParamSchema } from '@smsvio/shared';
import { adminMessageQuerySchema, reviewDecisionSchema } from '@smsvio/shared/compliance';
import type { FastifyRequest } from 'fastify';

import type { AuthState } from '../accounts/support.js';
import { SessionGuard } from '../accounts/guards.js';
import { clientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { firstQueryValues, parseInput } from '../http/parse.js';
import { OperatorService } from './operator.service.js';

@Controller('internal/admin')
@UseGuards(SessionGuard)
export class OperatorController {
  constructor(private readonly operator: OperatorService) {}

  @Get('reviews')
  reviews(@Req() request: FastifyRequest) {
    return this.operator.reviews(current(request));
  }

  @Post('reviews/verification/:id')
  verification(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    const decision = parseInput(reviewDecisionSchema, body);
    return this.operator.decideVerification(
      current(request),
      parseInput(idParamSchema, params).id,
      decision.decision,
      decision.note,
      clientInfo(request),
    );
  }

  @Post('reviews/use-cases/:id')
  useCase(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.decide(request, params, body, 'useCase');
  }

  @Post('reviews/senders/:id')
  sender(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.decide(request, params, body, 'sender');
  }

  @Post('reviews/templates/:id')
  template(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.decide(request, params, body, 'template');
  }

  @Get('messages')
  messages(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.operator.messages(
      current(request),
      parseInput(adminMessageQuerySchema, firstQueryValues(query)),
    );
  }

  @Get('health')
  health(@Req() request: FastifyRequest) {
    return this.operator.health(current(request));
  }

  @Get('margin')
  margin(@Req() request: FastifyRequest) {
    return this.operator.margin(current(request));
  }

  @Get('audit')
  audit(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.operator.audit(
      current(request),
      parseInput(adminMessageQuerySchema, firstQueryValues(query)),
    );
  }

  private decide(
    request: FastifyRequest,
    params: unknown,
    body: unknown,
    kind: 'useCase' | 'sender' | 'template',
  ) {
    const decision = parseInput(reviewDecisionSchema, body);
    const id = parseInput(idParamSchema, params).id;
    const state = current(request);
    const client = clientInfo(request);
    if (kind === 'useCase') {
      return this.operator.decideUseCase(state, id, decision.decision, decision.note, client);
    }
    if (kind === 'sender') {
      return this.operator.decideSender(state, id, decision.decision, decision.note, client);
    }
    return this.operator.decideTemplate(state, id, decision.decision, decision.note, client);
  }
}

function current(request: FastifyRequest): AuthState {
  if (request.auth === undefined) {
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }
  return request.auth;
}
