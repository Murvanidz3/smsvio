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
import { idParamSchema } from '@smsvio/shared';
import {
  adminListSchema,
  balanceAdjustmentSchema,
  clearRateSchema,
  createProviderSchema,
  createRouteSchema,
  orgRateSchema,
  organizationStatusSchema,
  platformSpendCapSchema,
  rateImportSchema,
  spendCapSchema,
  updateProviderSchema,
  updateRouteSchema,
} from '@smsvio/shared/billing';
import type { FastifyRequest } from 'fastify';

import { assertPlatformAdmin, type AuthState } from '../accounts/support.js';
import { SessionGuard } from '../accounts/guards.js';
import { clientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { firstQueryValues, parseInput } from '../http/parse.js';
import { LedgerService } from './ledger.service.js';
import { OrganizationAdminService } from './organization-admin.service.js';
import { ProviderAdminService } from './provider-admin.service.js';
import { RateAdminService } from './rate-admin.service.js';

@Controller('internal/admin')
@UseGuards(SessionGuard)
export class AdminController {
  constructor(
    private readonly organizations: OrganizationAdminService,
    private readonly providers: ProviderAdminService,
    private readonly rates: RateAdminService,
    private readonly ledger: LedgerService,
  ) {}

  @Get('organizations')
  listOrganizations(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.organizations.list(
      current(request),
      parseInput(adminListSchema, firstQueryValues(query)),
    );
  }

  @Post('organizations/:id/status')
  @HttpCode(200)
  setStatus(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.organizations.setStatus(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(organizationStatusSchema, body).status,
      clientInfo(request),
    );
  }

  @Post('organizations/:id/balance')
  @HttpCode(200)
  adjust(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.organizations.adjust(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(balanceAdjustmentSchema, body),
      clientInfo(request),
    );
  }

  @Patch('organizations/:id/spend-cap')
  setSpendCap(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.organizations.setSpendCap(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(spendCapSchema, body).dailySpendCap,
      clientInfo(request),
    );
  }

  @Get('settings')
  settings(@Req() request: FastifyRequest) {
    return this.organizations.settings(current(request));
  }

  @Patch('settings')
  setSettings(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.organizations.setPlatformCap(
      current(request),
      parseInput(platformSpendCapSchema, body).defaultDailySpendCap,
      clientInfo(request),
    );
  }

  @Post('ledger/check')
  @HttpCode(200)
  ledgerCheck(@Req() request: FastifyRequest) {
    assertPlatformAdmin(current(request));
    return this.ledger.differences();
  }

  @Get('countries')
  countries(@Req() request: FastifyRequest) {
    return this.organizations.countries(current(request));
  }

  @Get('providers')
  providersList(@Req() request: FastifyRequest) {
    return this.providers.providers(current(request));
  }

  @Post('providers')
  @HttpCode(200)
  createProvider(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.providers.create(
      current(request),
      parseInput(createProviderSchema, body),
      clientInfo(request),
    );
  }

  @Patch('providers/:id')
  updateProvider(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.providers.update(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(updateProviderSchema, body),
      clientInfo(request),
    );
  }

  @Post('providers/:id/health')
  @HttpCode(200)
  health(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.providers.health(current(request), parseInput(idParamSchema, params).id);
  }

  @Get('routes')
  routes(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.providers.routes(
      current(request),
      parseInput(adminListSchema, firstQueryValues(query)),
    );
  }

  @Post('routes')
  @HttpCode(200)
  createRoute(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.providers.createRoute(
      current(request),
      parseInput(createRouteSchema, body),
      clientInfo(request),
    );
  }

  @Patch('routes/:id')
  updateRoute(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.providers.updateRoute(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(updateRouteSchema, body),
      clientInfo(request),
    );
  }

  @Delete('routes/:id')
  @HttpCode(200)
  deleteRoute(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.providers.deleteRoute(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Get('rates')
  ratesList(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.rates.list(current(request), parseInput(adminListSchema, firstQueryValues(query)));
  }

  @Post('rates/preview')
  @HttpCode(200)
  previewRates(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.rates.preview(current(request), parseInput(rateImportSchema, body).csv);
  }

  @Post('rates/import')
  @HttpCode(200)
  importRates(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.rates.commit(
      current(request),
      parseInput(rateImportSchema, body).csv,
      clientInfo(request),
    );
  }

  @Post('rates/org')
  @HttpCode(200)
  orgRate(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.rates.setOrgRate(
      current(request),
      parseInput(orgRateSchema, body),
      clientInfo(request),
    );
  }

  @Post('rates/clear')
  @HttpCode(200)
  clearRate(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.rates.clear(
      current(request),
      parseInput(clearRateSchema, body),
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
