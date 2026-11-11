import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { MockProvider, hashProviderSecret } from '@smsvio/shared/provider';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertPlatformAdmin, writeAudit } from '../accounts/support.js';
import type { ClientInfo } from '../http/client.js';
import { encryptString } from '../security/encryption.js';
import { randomToken } from '../security/tokens.js';
import type { ApiEnv } from '../env.js';
import { API_ENV } from '../config.js';
import { PricingService } from './pricing.service.js';
import { isUniqueViolation, notFound, requireUsd, validation } from './present.js';

@Injectable()
export class ProviderAdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly pricing: PricingService,
  ) {}

  async providers(state: AuthState) {
    assertPlatformAdmin(state);
    const rows = await this.prisma.provider.findMany({ orderBy: { code: 'asc' } });
    const routes = await this.prisma.route.findMany();
    return {
      items: rows.map((provider) => ({
        id: provider.id,
        code: provider.code,
        type: provider.type,
        status: provider.status,
        maxTps: provider.maxTps,
        markupPercent: provider.markupPercent,
        hasCredentials: provider.configEnc !== null,
        hasCallbackSecret: provider.callbackSecretHash !== null,
        routes: routes.filter((route) => route.providerId === provider.id).length,
      })),
    };
  }

  async create(
    state: AuthState,
    input: {
      code: string;
      type: 'MOCK' | 'SMPP' | 'HTTP';
      markupPercent: number;
      maxTps: number;
      config?: string;
    },
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    const secret = randomToken();
    try {
      const provider = await this.prisma.provider.create({
        data: {
          code: input.code,
          type: input.type,
          markupPercent: input.markupPercent,
          maxTps: input.maxTps,
          status: 'ACTIVE',
          configEnc: this.encryptConfig(input.config),
          callbackSecretHash: hashProviderSecret(secret),
        },
      });
      await writeAudit(this.prisma, {
        organizationId: null,
        actorUserId: state.userId,
        action: 'provider.create',
        targetType: 'provider',
        targetId: provider.id,
        meta: { code: provider.code, markupPercent: provider.markupPercent },
        ip: client.ip,
      });
      return {
        id: provider.id,
        callbackSecret: secret,
        message: 'Provider saved. Copy the callback secret now. It is not shown again.',
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw validation({ code: 'A provider with that code already exists.' });
      }
      throw error;
    }
  }

  async update(
    state: AuthState,
    id: string,
    input: {
      markupPercent: number;
      maxTps: number;
      status: 'ACTIVE' | 'DISABLED';
      config?: string;
      rotateSecret?: boolean;
    },
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    const provider = await this.prisma.provider.findUnique({ where: { id } });
    if (provider === null) {
      throw notFound();
    }
    const secret = input.rotateSecret === true ? randomToken() : undefined;
    const configEnc = input.config === undefined ? undefined : this.encryptConfig(input.config);
    await this.prisma.provider.update({
      where: { id },
      data: {
        markupPercent: input.markupPercent,
        maxTps: input.maxTps,
        status: input.status,
        ...(configEnc === undefined ? {} : { configEnc }),
        ...(secret === undefined ? {} : { callbackSecretHash: hashProviderSecret(secret) }),
      },
    });
    await writeAudit(this.prisma, {
      organizationId: null,
      actorUserId: state.userId,
      action: 'provider.update',
      targetType: 'provider',
      targetId: id,
      meta: { markupPercent: input.markupPercent, status: input.status },
      ip: client.ip,
    });
    return {
      message: 'Provider updated. Customer prices use the new markup.',
      ...(secret === undefined ? {} : { callbackSecret: secret }),
    };
  }

  async health(state: AuthState, id: string) {
    assertPlatformAdmin(state);
    const provider = await this.prisma.provider.findUnique({ where: { id } });
    if (provider === null) {
      throw notFound();
    }
    if (provider.type !== 'MOCK') {
      return {
        ok: false,
        detail: 'This provider type is not connected yet. Nothing was contacted.',
      };
    }
    const mock = new MockProvider({
      code: provider.code,
      callbackSecretHash: provider.callbackSecretHash,
    });
    return mock.healthCheck();
  }

  async routes(
    state: AuthState,
    query: { q?: string; page: number; pageSize: number; country?: string; providerId?: string },
  ) {
    assertPlatformAdmin(state);
    return this.pricing.describeRoutes(query);
  }

  async createRoute(
    state: AuthState,
    input: {
      countryIso2: string;
      mccmnc: string | null;
      providerId: string;
      priority: number;
      weight: number;
      cost: string;
      markupPercent: number | null;
      enabled: boolean;
    },
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    await this.requireDestination(input.countryIso2, input.providerId);
    const costMicros = requireUsd(input.cost, 'cost', true);
    try {
      const route = await this.prisma.route.create({
        data: {
          countryIso2: input.countryIso2,
          mccmnc: input.mccmnc,
          providerId: input.providerId,
          priority: input.priority,
          weight: input.weight,
          costMicros,
          markupPercent: input.markupPercent,
          enabled: input.enabled,
        },
      });
      await writeAudit(this.prisma, {
        organizationId: null,
        actorUserId: state.userId,
        action: 'route.create',
        targetType: 'route',
        targetId: route.id,
        meta: { countryIso2: input.countryIso2, costMicros: costMicros.toString() },
        ip: client.ip,
      });
      return { id: route.id, message: 'Route saved. Customer prices were recalculated.' };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw validation({
          countryIso2: 'That provider already has a route for this destination.',
        });
      }
      throw error;
    }
  }

  async updateRoute(
    state: AuthState,
    id: string,
    input: {
      priority: number;
      weight: number;
      cost: string;
      markupPercent: number | null;
      enabled: boolean;
    },
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    const route = await this.prisma.route.findUnique({ where: { id } });
    if (route === null) {
      throw notFound();
    }
    const costMicros = requireUsd(input.cost, 'cost', true);
    await this.prisma.route.update({
      where: { id },
      data: {
        priority: input.priority,
        weight: input.weight,
        costMicros,
        markupPercent: input.markupPercent,
        enabled: input.enabled,
      },
    });
    await writeAudit(this.prisma, {
      organizationId: null,
      actorUserId: state.userId,
      action: 'route.update',
      targetType: 'route',
      targetId: id,
      meta: { costMicros: costMicros.toString(), enabled: input.enabled },
      ip: client.ip,
    });
    return { message: 'Route updated. Customer prices were recalculated.' };
  }

  async deleteRoute(state: AuthState, id: string, client: ClientInfo) {
    assertPlatformAdmin(state);
    const route = await this.prisma.route.findUnique({ where: { id } });
    if (route === null) {
      throw notFound();
    }
    await this.prisma.route.delete({ where: { id } });
    await writeAudit(this.prisma, {
      organizationId: null,
      actorUserId: state.userId,
      action: 'route.delete',
      targetType: 'route',
      targetId: id,
      meta: { countryIso2: route.countryIso2 },
      ip: client.ip,
    });
    return { message: 'Route deleted. Customer prices were recalculated.' };
  }

  private async requireDestination(countryIso2: string, providerId: string) {
    const country = await this.prisma.country.findUnique({ where: { iso2: countryIso2 } });
    if (country?.enabled !== true) {
      throw validation({ countryIso2: 'Choose an enabled country.' });
    }
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (provider === null) {
      throw validation({ providerId: 'Choose a provider.' });
    }
  }

  private encryptConfig(config: string | undefined): string | null {
    if (config === undefined || config === '') {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(config);
    } catch {
      throw validation({ config: 'Credentials have to be a JSON object.' });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw validation({ config: 'Credentials have to be a JSON object.' });
    }
    return encryptString(config, this.env.APP_ENCRYPTION_KEY);
  }
}
