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
  idParamSchema,
  openApiDocument,
  publicBatchSchema,
  publicContactPatchSchema,
  publicContactSchema,
  publicCursorQuerySchema,
  publicLookupSchema,
  publicMessageQuerySchema,
  publicSendSchema,
  webhookPatchSchema,
  webhookWriteSchema,
} from '@smsvio/shared';
import type { FastifyRequest } from 'fastify';

import type { AuthState } from '../accounts/support.js';
import { clientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { firstQueryValues, parseInput } from '../http/parse.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { PublicService } from './public.service.js';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class PublicController {
  constructor(private readonly api: PublicService) {}

  @Get('openapi.json')
  document() {
    return openApiDocument();
  }

  @Post('messages')
  @HttpCode(202)
  send(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parseInput(publicSendSchema, body);
    const key = idempotencyHeader(request);
    if (key !== undefined && input.client_ref !== undefined && key !== input.client_ref) {
      throw new ApiError(400, 'validation_error', 'Idempotency-Key and client_ref must match.', {
        client_ref: 'Use the same value as Idempotency-Key.',
      });
    }
    return this.api.sendMessage(
      current(request),
      { ...input, client_ref: input.client_ref ?? key },
      requireKey(request),
    );
  }

  @Post('messages/batch')
  @HttpCode(200)
  batch(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parseInput(publicBatchSchema, body);
    return this.api.sendBatch(
      current(request),
      input.messages,
      idempotencyHeader(request),
      requireKey(request),
    );
  }

  @Get('messages')
  listMessages(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.api.listMessages(
      current(request),
      parseInput(publicMessageQuerySchema, firstQueryValues(query)),
    );
  }

  @Get('messages/:id')
  getMessage(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.api.getMessage(current(request), parseInput(idParamSchema, params).id);
  }

  @Get('contacts')
  listContacts(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.api.listContacts(
      current(request),
      parseInput(publicCursorQuerySchema, firstQueryValues(query)),
    );
  }

  @Post('contacts')
  @HttpCode(201)
  createContact(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.api.createContact(
      current(request),
      parseInput(publicContactSchema, body),
      clientInfo(request),
    );
  }

  @Get('contacts/:id')
  getContact(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.api.getContact(current(request), parseInput(idParamSchema, params).id);
  }

  @Patch('contacts/:id')
  updateContact(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.api.updateContact(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(publicContactPatchSchema, body),
      clientInfo(request),
    );
  }

  @Delete('contacts/:id')
  @HttpCode(200)
  deleteContact(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.api.deleteContact(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Get('templates')
  listTemplates(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.api.listTemplates(
      current(request),
      parseInput(publicCursorQuerySchema, firstQueryValues(query)),
    );
  }

  @Get('templates/:id')
  getTemplate(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.api.getTemplate(current(request), parseInput(idParamSchema, params).id);
  }

  @Get('senders')
  senders(@Req() request: FastifyRequest) {
    return this.api.sendersView(current(request));
  }

  @Get('balance')
  balance(@Req() request: FastifyRequest) {
    return this.api.balance(current(request));
  }

  @Get('rates')
  rates(@Req() request: FastifyRequest) {
    return this.api.rates(current(request));
  }

  @Post('lookup')
  @HttpCode(200)
  lookup(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.api.lookup(
      current(request),
      requireKey(request).id,
      parseInput(publicLookupSchema, body),
    );
  }

  @Get('webhooks')
  listWebhooks(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.api.listWebhooks(
      current(request),
      parseInput(publicCursorQuerySchema, firstQueryValues(query)),
    );
  }

  @Post('webhooks')
  @HttpCode(201)
  createWebhook(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.api.createWebhook(
      current(request),
      parseInput(webhookWriteSchema, body),
      clientInfo(request),
    );
  }

  @Get('webhooks/:id')
  getWebhook(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.api.getWebhook(current(request), parseInput(idParamSchema, params).id);
  }

  @Patch('webhooks/:id')
  updateWebhook(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.api.updateWebhook(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(webhookPatchSchema, body),
      clientInfo(request),
    );
  }

  @Delete('webhooks/:id')
  @HttpCode(200)
  deleteWebhook(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.api.deleteWebhook(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }
}

function current(request: FastifyRequest): AuthState {
  if (request.auth === undefined) {
    throw new ApiError(401, 'unauthenticated', 'That API key is not valid.');
  }
  return request.auth;
}

function requireKey(request: FastifyRequest): { id: string; mode: 'LIVE' | 'TEST' } {
  if (request.apiKey === undefined) {
    throw new ApiError(401, 'unauthenticated', 'That API key is not valid.');
  }
  return request.apiKey;
}

function idempotencyHeader(request: FastifyRequest): string | undefined {
  const value = request.headers['idempotency-key'];
  const header = Array.isArray(value) ? value[0] : value;
  if (header === undefined || header.trim() === '') {
    return undefined;
  }
  if (header.length > 128) {
    throw new ApiError(400, 'validation_error', 'Idempotency-Key is too long.', {
      'idempotency-key': 'Use at most 128 characters.',
    });
  }
  return header.trim();
}
