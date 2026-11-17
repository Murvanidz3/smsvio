import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createApiKeySchema,
  idParamSchema,
  replaySchema,
  updateApiKeySchema,
  webhookPatchSchema,
  webhookWriteSchema,
} from '@smsvio/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AuthState } from '../accounts/support.js';
import { SessionGuard } from '../accounts/guards.js';
import { clientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { firstQueryValues, parseInput } from '../http/parse.js';
import { ApiKeyService } from './keys.service.js';
import { WebhookService } from './webhooks.service.js';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@Controller('internal')
@UseGuards(SessionGuard)
export class DeveloperController {
  constructor(
    private readonly keys: ApiKeyService,
    private readonly webhooks: WebhookService,
  ) {}

  @Get('api-keys')
  listKeys(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.keys.list(current(request), parseInput(pageQuery, firstQueryValues(query)));
  }

  @Post('api-keys')
  @HttpCode(201)
  createKey(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.keys.create(
      current(request),
      parseInput(createApiKeySchema, body),
      clientInfo(request),
    );
  }

  @Patch('api-keys/:id')
  updateKey(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.keys.update(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(updateApiKeySchema, body),
      clientInfo(request),
    );
  }

  @Delete('api-keys/:id')
  @HttpCode(200)
  deleteKey(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.keys.remove(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Get('webhooks')
  listWebhooks(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.webhooks.list(current(request), parseInput(pageQuery, firstQueryValues(query)));
  }

  @Post('webhooks')
  @HttpCode(201)
  createWebhook(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.webhooks.create(
      current(request),
      parseInput(webhookWriteSchema, body),
      clientInfo(request),
    );
  }

  @Get('webhooks/:id')
  getWebhook(@Req() request: FastifyRequest, @Param() params: unknown, @Query() query: unknown) {
    return this.webhooks.get(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(pageQuery, firstQueryValues(query)),
    );
  }

  @Patch('webhooks/:id')
  updateWebhook(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.webhooks.update(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(webhookPatchSchema, body),
      clientInfo(request),
    );
  }

  @Delete('webhooks/:id')
  @HttpCode(200)
  deleteWebhook(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.webhooks.remove(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Post('webhooks/:id/secret')
  @HttpCode(200)
  reveal(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.webhooks.reveal(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Post('webhooks/:id/rotate')
  @HttpCode(200)
  rotate(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.webhooks.rotate(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  test(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.webhooks.sendTest(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Post('webhooks/:id/replay')
  @HttpCode(200)
  replay(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.webhooks.replay(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(replaySchema, body).delivery_id,
      clientInfo(request),
    );
  }
}

function current(request: FastifyRequest): AuthState {
  if (request.auth === undefined) {
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }
  return request.auth;
}
