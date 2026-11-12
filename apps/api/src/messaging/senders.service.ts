import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { smsErrorMessage, checkSender } from '@smsvio/shared';
import {
  PLATFORM_SENDER_LABEL,
  PLATFORM_SETTING_ID,
  configuredSharedSender,
} from '@smsvio/shared/billing';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertCapability, writeAudit } from '../accounts/support.js';
import type { ClientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { PricingService } from './pricing.service.js';
import { isUniqueViolation, notFound, presentMoney } from './present.js';

@Injectable()
export class SenderService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly pricing: PricingService,
  ) {}

  async overview(state: AuthState) {
    assertCapability(state, 'view');
    const organizationId = state.organizationId;
    const [countries, enabled, senderIds, setting] = await Promise.all([
      this.prisma.country.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
      this.prisma.orgCountry.findMany({ where: { organizationId } }),
      this.prisma.senderId.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.platformSetting.findUnique({ where: { id: PLATFORM_SETTING_ID } }),
    ]);
    const shared = configuredSharedSender(setting?.sharedSender);
    const enabledByCountry = new Map(enabled.map((row) => [row.countryIso2, row]));
    const senderById = new Map(senderIds.map((row) => [row.id, row]));
    const prices = await this.pricing.quoteMap(organizationId);
    const destinations = [];
    for (const country of countries) {
      const row = enabledByCountry.get(country.iso2) ?? null;
      const quote = prices.get(country.iso2) ?? null;
      const sender =
        row === null
          ? null
          : row.senderIdId === null
            ? shared === null
              ? null
              : { id: null, value: shared, label: PLATFORM_SENDER_LABEL }
            : {
                id: row.senderIdId,
                value: senderById.get(row.senderIdId)?.value ?? '',
                label: senderById.get(row.senderIdId)?.value ?? '',
              };
      destinations.push({
        iso2: country.iso2,
        name: country.name,
        dialCode: country.dialCode,
        alphaSenderAllowed: country.alphaSenderAllowed,
        registrationRequired: country.registrationRequired,
        enabled: row !== null,
        orgCountryId: row?.id ?? null,
        registrationComplete: row?.registrationComplete ?? false,
        sender,
        price: quote === null ? null : presentMoney(quote.micros, 4),
        priceSource: quote?.source ?? null,
      });
    }
    return {
      platformSender: shared === null ? null : { value: shared, label: PLATFORM_SENDER_LABEL },
      destinations,
      senderIds: senderIds.map((sender) => ({
        id: sender.id,
        type: sender.type,
        value: sender.value,
        status: sender.status,
        useCase: sender.useCase,
        reviewNote: sender.reviewNote,
        countries: sender.intendedCountries,
        createdAt: sender.createdAt.toISOString(),
      })),
    };
  }

  async addCountry(
    state: AuthState,
    input: { countryIso2: string; senderId: string | null },
    client: ClientInfo,
  ) {
    assertCapability(state, 'compliance');
    const country = await this.prisma.country.findUnique({ where: { iso2: input.countryIso2 } });
    if (country?.enabled !== true) {
      throw new ApiError(400, 'country_not_supported', smsErrorMessage('country_not_supported'));
    }
    const existing = await this.prisma.orgCountry.findFirst({
      where: { organizationId: state.organizationId, countryIso2: input.countryIso2 },
    });
    if (existing !== null) {
      return { id: existing.id, message: 'That country is already enabled.' };
    }
    if (input.senderId !== null) {
      const sender = await this.prisma.senderId.findFirst({
        where: { id: input.senderId, organizationId: state.organizationId, status: 'APPROVED' },
      });
      if (sender === null) {
        throw new ApiError(400, 'sender_not_approved', smsErrorMessage('sender_not_approved'));
      }
      if (sender.type === 'ALPHANUMERIC' && !country.alphaSenderAllowed) {
        throw new ApiError(400, 'invalid_sender', smsErrorMessage('invalid_sender'));
      }
    }
    try {
      const created = await this.prisma.orgCountry.create({
        data: {
          organizationId: state.organizationId,
          countryIso2: input.countryIso2,
          senderIdId: input.senderId,
          registrationComplete: !country.registrationRequired,
        },
      });
      await writeAudit(this.prisma, {
        organizationId: state.organizationId,
        actorUserId: state.userId,
        action: 'sender.country_add',
        targetType: 'org_country',
        targetId: created.id,
        meta: { countryIso2: input.countryIso2, senderId: input.senderId },
        ip: client.ip,
      });
      return { id: created.id, message: `${country.name} is enabled.` };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.prisma.orgCountry.findFirst({
          where: { organizationId: state.organizationId, countryIso2: input.countryIso2 },
        });
        if (again !== null) {
          return { id: again.id, message: 'That country is already enabled.' };
        }
      }
      throw error;
    }
  }

  async removeCountry(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'compliance');
    const row = await this.prisma.orgCountry.findFirst({
      where: { id, organizationId: state.organizationId },
    });
    if (row === null) {
      throw notFound();
    }
    await this.prisma.orgCountry.delete({ where: { id } });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'sender.country_remove',
      targetType: 'org_country',
      targetId: id,
      meta: { countryIso2: row.countryIso2 },
      ip: client.ip,
    });
    return { message: 'Country removed.' };
  }

  async requestSender(
    state: AuthState,
    input: {
      type: 'ALPHANUMERIC' | 'LONG_CODE' | 'SHORT_CODE';
      value: string;
      useCase: string;
      countries: string[];
    },
    client: ClientInfo,
  ) {
    assertCapability(state, 'compliance');
    const checked = checkSender(input.value, {
      alphanumericAllowed: input.type === 'ALPHANUMERIC',
    });
    const kind = input.type === 'ALPHANUMERIC' ? 'ALPHANUMERIC' : 'NUMERIC';
    if (!checked.ok || checked.kind !== kind) {
      throw new ApiError(400, 'invalid_sender', smsErrorMessage('invalid_sender'));
    }
    const countries = [...new Set(input.countries)];
    const rows = await this.prisma.country.findMany({
      where: { iso2: { in: countries }, enabled: true },
    });
    if (rows.length !== countries.length) {
      throw new ApiError(400, 'country_not_supported', smsErrorMessage('country_not_supported'));
    }
    if (input.type === 'ALPHANUMERIC' && rows.some((country) => !country.alphaSenderAllowed)) {
      throw new ApiError(400, 'invalid_sender', smsErrorMessage('invalid_sender'));
    }
    try {
      const sender = await this.prisma.senderId.create({
        data: {
          organizationId: state.organizationId,
          type: input.type,
          value: checked.value,
          useCase: input.useCase,
          intendedCountries: countries,
          status: 'PENDING',
        },
      });
      await writeAudit(this.prisma, {
        organizationId: state.organizationId,
        actorUserId: state.userId,
        action: 'sender.request',
        targetType: 'sender_id',
        targetId: sender.id,
        meta: { value: sender.value, type: sender.type },
        ip: client.ip,
      });
      return {
        id: sender.id,
        message: 'Sender request submitted. It stays pending until an operator reviews it.',
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'sender_exists', 'That sender id is already on this account.');
      }
      throw error;
    }
  }

  async getSender(state: AuthState, id: string) {
    assertCapability(state, 'view');
    const sender = await this.prisma.senderId.findFirst({
      where: { id, organizationId: state.organizationId },
    });
    if (sender === null) {
      throw notFound();
    }
    return {
      id: sender.id,
      type: sender.type,
      value: sender.value,
      status: sender.status,
      useCase: sender.useCase,
      reviewNote: sender.reviewNote,
      countries: sender.intendedCountries,
    };
  }
}
