import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { idParamSchema } from '@smsvio/shared';
import {
  autoReplySchema,
  complianceBusinessSchema,
  complianceDocumentSchema,
  useCaseSchema,
} from '@smsvio/shared/compliance';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuthState } from '../accounts/support.js';
import { SessionGuard } from '../accounts/guards.js';
import { clientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { parseInput } from '../http/parse.js';
import { ComplianceService } from './compliance.service.js';

@Controller('internal/compliance')
@UseGuards(SessionGuard)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  view(@Req() request: FastifyRequest) {
    return this.compliance.view(current(request));
  }

  @Post('business')
  business(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.compliance.submitBusiness(
      current(request),
      parseInput(complianceBusinessSchema, body),
      clientInfo(request),
    );
  }

  @Post('use-cases')
  useCase(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.compliance.addUseCase(
      current(request),
      parseInput(useCaseSchema, body),
      clientInfo(request),
    );
  }

  @Post('documents')
  document(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.compliance.addDocument(
      current(request),
      parseInput(complianceDocumentSchema, body),
      clientInfo(request),
    );
  }

  @Get('documents/:id')
  async download(
    @Req() request: FastifyRequest,
    @Param() params: unknown,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.compliance.download(
      current(request),
      parseInput(idParamSchema, params).id,
    );
    await reply
      .header('content-type', file.contentType)
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .send(file.bytes);
  }

  @Post('replies')
  createReply(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.compliance.saveReply(
      current(request),
      parseInput(autoReplySchema, body),
      clientInfo(request),
    );
  }

  @Patch('replies/:id')
  updateReply(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.compliance.saveReply(
      current(request),
      parseInput(autoReplySchema, body),
      clientInfo(request),
      parseInput(idParamSchema, params).id,
    );
  }

  @Delete('replies/:id')
  deleteReply(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.compliance.deleteReply(
      current(request),
      parseInput(idParamSchema, params).id,
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
