import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { parseRateCsv } from '@smsvio/shared/billing';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertPlatformAdmin, writeAudit } from '../accounts/support.js';
import type { ClientInfo } from '../http/client.js';
import { PricingService } from './pricing.service.js';
import { notFound, presentMoney, requireUsd, validation } from './present.js';

@Injectable()
export class RateAdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly pricing: PricingService,
  ) {}

  async list(
    state: AuthState,
    query: { q?: string; page: number; pageSize: number; organizationId?: string },
  ) {
    assertPlatformAdmin(state);
    if (query.organizationId !== undefined) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: query.organizationId },
      });
      if (organization === null) {
        throw notFound();
      }
    }
    return this.pricing.rateTable(query);
  }

  async preview(state: AuthState, csv: string) {
    assertPlatformAdmin(state);
    return this.inspect(csv);
  }

  async commit(state: AuthState, csv: string, client: ClientInfo) {
    assertPlatformAdmin(state);
    const inspected = await this.inspect(csv);
    if (!inspected.ok) {
      throw validation({ csv: 'Fix the rows in the preview before importing.' });
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const row of inspected.rows) {
        await tx.rate.create({
          data: {
            countryIso2: row.countryIso2,
            mccmnc: row.mccmnc,
            priceMicros: BigInt(row.price.micros),
            effectiveFrom: now,
          },
        });
      }
    });
    await writeAudit(this.prisma, {
      organizationId: null,
      actorUserId: state.userId,
      action: 'rate.import',
      targetType: 'rate',
      meta: { rows: inspected.rows.length },
      ip: client.ip,
    });
    return { message: `Imported ${String(inspected.rows.length)} manual prices.` };
  }

  async setOrgRate(
    state: AuthState,
    input: { organizationId: string; countryIso2: string; mccmnc: string | null; price: string },
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    const organization = await this.prisma.organization.findUnique({
      where: { id: input.organizationId },
    });
    const country = await this.prisma.country.findUnique({ where: { iso2: input.countryIso2 } });
    if (organization === null || country?.enabled !== true) {
      throw validation({ organizationId: 'Choose an organization and an enabled country.' });
    }
    const priceMicros = requireUsd(input.price, 'price', false);
    await this.prisma.orgRate.create({
      data: {
        organizationId: input.organizationId,
        countryIso2: input.countryIso2,
        mccmnc: input.mccmnc,
        priceMicros,
        effectiveFrom: new Date(),
      },
    });
    await writeAudit(this.prisma, {
      organizationId: input.organizationId,
      actorUserId: state.userId,
      action: 'rate.org',
      targetType: 'organization',
      targetId: input.organizationId,
      meta: { countryIso2: input.countryIso2, priceMicros: priceMicros.toString() },
      ip: client.ip,
    });
    return { message: 'Per-customer price saved.' };
  }

  async clear(
    state: AuthState,
    input: { countryIso2: string; mccmnc: string | null; organizationId: string | null },
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    const where = { countryIso2: input.countryIso2, mccmnc: input.mccmnc };
    const removed =
      input.organizationId === null
        ? await this.prisma.rate.deleteMany({ where })
        : await this.prisma.orgRate.deleteMany({
            where: { ...where, organizationId: input.organizationId },
          });
    await writeAudit(this.prisma, {
      organizationId: input.organizationId,
      actorUserId: state.userId,
      action: 'rate.clear',
      targetType: 'rate',
      meta: { countryIso2: input.countryIso2, removed: removed.count },
      ip: client.ip,
    });
    return { message: 'The fixed price was removed. The computed price is used again.' };
  }

  private async inspect(csv: string) {
    const parsed = parseRateCsv(csv);
    if (!parsed.ok) {
      return parsed;
    }
    const countries = await this.prisma.country.findMany({ where: { enabled: true } });
    const enabled = new Set(countries.map((country) => country.iso2));
    const errors = parsed.rows
      .filter((row) => !enabled.has(row.countryIso2))
      .map((row) => ({ line: row.line, message: `${row.countryIso2} is not an enabled country.` }));
    if (errors.length > 0) {
      return { ok: false as const, errors };
    }
    return {
      ok: true as const,
      rows: parsed.rows.map((row) => ({
        line: row.line,
        countryIso2: row.countryIso2,
        mccmnc: row.mccmnc,
        price: presentMoney(row.priceMicros, 4),
      })),
    };
  }
}
