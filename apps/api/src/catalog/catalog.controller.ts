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
  analyticsQuerySchema,
  contactListSchema,
  createContactSchema,
  galleryCopySchema,
  idParamSchema,
  importContactsSchema,
  lookupSchema,
  saveTemplateSchema,
  templateListSchema,
} from '@smsvio/shared';
import type { FastifyRequest } from 'fastify';

import type { AuthState } from '../accounts/support.js';
import { SessionGuard } from '../accounts/guards.js';
import { clientInfo } from '../http/client.js';
import { firstQueryValues, parseInput } from '../http/parse.js';
import { ApiError } from '../http/api-error.js';
import { ContactService } from './contacts.service.js';
import { LookupService } from './lookup.service.js';
import { TemplateService } from './templates.service.js';

@Controller('internal')
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(
    private readonly contacts: ContactService,
    private readonly templates: TemplateService,
    private readonly lookup: LookupService,
  ) {}

  @Get('countries')
  countries(@Req() request: FastifyRequest) {
    return this.lookup.countries(current(request));
  }

  @Post('tools/lookup')
  @HttpCode(200)
  numberLookup(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.lookup.lookup(current(request), parseInput(lookupSchema, body));
  }

  @Get('contacts')
  listContacts(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.contacts.list(
      current(request),
      parseInput(contactListSchema, firstQueryValues(query)),
    );
  }

  @Post('contacts')
  @HttpCode(200)
  createContact(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.contacts.create(
      current(request),
      parseInput(createContactSchema, body),
      clientInfo(request),
    );
  }

  @Post('contacts/import')
  @HttpCode(200)
  importContacts(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.contacts.import(
      current(request),
      parseInput(importContactsSchema, body),
      clientInfo(request),
    );
  }

  @Get('contacts/:id')
  getContact(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.contacts.get(current(request), parseInput(idParamSchema, params).id);
  }

  @Delete('contacts/:id')
  @HttpCode(200)
  deleteContact(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.contacts.remove(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Get('templates/gallery')
  gallery(@Req() request: FastifyRequest) {
    return this.templates.gallery(current(request));
  }

  @Get('templates')
  listTemplates(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.templates.list(
      current(request),
      parseInput(templateListSchema, firstQueryValues(query)),
    );
  }

  @Post('templates')
  @HttpCode(200)
  createTemplate(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.templates.create(
      current(request),
      parseInput(saveTemplateSchema, body),
      clientInfo(request),
    );
  }

  @Post('templates/gallery')
  @HttpCode(200)
  copyGallery(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.templates.copyGallery(
      current(request),
      parseInput(galleryCopySchema, body).id,
      clientInfo(request),
    );
  }

  @Get('templates/:id/analytics')
  analytics(@Req() request: FastifyRequest, @Param() params: unknown, @Query() query: unknown) {
    return this.templates.analytics(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(analyticsQuerySchema, firstQueryValues(query)).days,
    );
  }

  @Get('templates/:id')
  getTemplate(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.templates.get(current(request), parseInput(idParamSchema, params).id);
  }

  @Patch('templates/:id')
  updateTemplate(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.templates.update(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(saveTemplateSchema, body),
      clientInfo(request),
    );
  }

  @Post('templates/:id/submit')
  @HttpCode(200)
  submitTemplate(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.templates.submit(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Post('templates/:id/duplicate')
  @HttpCode(200)
  duplicateTemplate(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.templates.duplicate(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Delete('templates/:id')
  @HttpCode(200)
  deleteTemplate(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.templates.remove(
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
