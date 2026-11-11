import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import {
  DEFAULT_DAILY_SPEND_CAP_MICROS,
  PLATFORM_SETTING_ID,
  effectiveDailySpendCap,
} from '@smsvio/shared/billing';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertPlatformAdmin, writeAudit } from '../accounts/support.js';
import type { ClientInfo } from '../http/client.js';
import { isUniqueViolation, notFound, presentMoney, requireUsd } from './present.js';
import { LedgerService } from './ledger.service.js';

@Injectable()
export class OrganizationAdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  async list(state: AuthState, query: { q?: string; page: number; pageSize: number }) {
    assertPlatformAdmin(state);
    const where =
      query.q === undefined
        ? {}
        : {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { legalName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          };
    const cap = await this.platformCap();
    const [total, rows] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const balances = await this.prisma.orgBalance.findMany({
      where: { organizationId: { in: rows.map((row) => row.id) } },
    });
    const balanceByOrg = new Map(balances.map((row) => [row.organizationId, row]));
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      platformSpendCap: presentMoney(cap, 2),
      items: rows.map((organization) => {
        const balance = balanceByOrg.get(organization.id);
        const inherited = organization.dailySpendCapMicros === null;
        const effective = effectiveDailySpendCap(organization.dailySpendCapMicros, cap);
        return {
          id: organization.id,
          name: organization.name,
          legalName: organization.legalName,
          status: organization.status,
          createdAt: organization.createdAt.toISOString(),
          available: presentMoney(balance?.availableMicros ?? 0n, 2),
          held: presentMoney(balance?.heldMicros ?? 0n, 2),
          spendCap: presentMoney(effective, 2),
          spendCapSource: inherited ? 'platform' : 'organization',
        };
      }),
    };
  }

  async setStatus(
    state: AuthState,
    id: string,
    status: 'ACTIVE' | 'SUSPENDED',
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    const organization = await this.prisma.organization.findUnique({ where: { id } });
    if (organization === null) {
      throw notFound();
    }
    await this.prisma.organization.update({ where: { id }, data: { status } });
    await writeAudit(this.prisma, {
      organizationId: id,
      actorUserId: state.userId,
      action: 'organization.status',
      targetType: 'organization',
      targetId: id,
      meta: { status },
      ip: client.ip,
    });
    return { message: status === 'SUSPENDED' ? 'Organization suspended.' : 'Organization active.' };
  }

  async adjust(
    state: AuthState,
    id: string,
    input: { direction: 'credit' | 'debit'; amount: string; reason: string },
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    return this.ledger.adjust(
      state.userId,
      id,
      {
        direction: input.direction,
        amount: requireUsd(input.amount, 'amount', false),
        reason: input.reason,
      },
      client,
    );
  }

  async setSpendCap(
    state: AuthState,
    id: string,
    dailySpendCap: string | null,
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    const organization = await this.prisma.organization.findUnique({ where: { id } });
    if (organization === null) {
      throw notFound();
    }
    const cap = dailySpendCap === null ? null : requireUsd(dailySpendCap, 'dailySpendCap', true);
    await this.prisma.organization.update({
      where: { id },
      data: { dailySpendCapMicros: cap },
    });
    await writeAudit(this.prisma, {
      organizationId: id,
      actorUserId: state.userId,
      action: 'organization.spend_cap',
      targetType: 'organization',
      targetId: id,
      meta: { dailySpendCapMicros: cap === null ? null : cap.toString() },
      ip: client.ip,
    });
    return {
      message: cap === null ? 'This organization uses the platform spend cap.' : 'Spend cap saved.',
    };
  }

  async settings(state: AuthState) {
    assertPlatformAdmin(state);
    const cap = await this.platformCap();
    return { defaultDailySpendCap: presentMoney(cap, 2) };
  }

  async setPlatformCap(state: AuthState, amount: string, client: ClientInfo) {
    assertPlatformAdmin(state);
    const cap = requireUsd(amount, 'defaultDailySpendCap', true);
    await this.prisma.platformSetting.upsert({
      where: { id: PLATFORM_SETTING_ID },
      create: { id: PLATFORM_SETTING_ID, defaultDailySpendCapMicros: cap },
      update: { defaultDailySpendCapMicros: cap },
    });
    await writeAudit(this.prisma, {
      organizationId: null,
      actorUserId: state.userId,
      action: 'platform.spend_cap',
      targetType: 'platform_setting',
      targetId: PLATFORM_SETTING_ID,
      meta: { defaultDailySpendCapMicros: cap.toString() },
      ip: client.ip,
    });
    return { message: 'Default daily spend cap saved.' };
  }

  async countries(state: AuthState) {
    assertPlatformAdmin(state);
    const rows = await this.prisma.country.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
    });
    return {
      items: rows.map((country) => ({
        iso2: country.iso2,
        name: country.name,
        dialCode: country.dialCode,
      })),
    };
  }

  private async platformCap(): Promise<bigint> {
    const existing = await this.prisma.platformSetting.findUnique({
      where: { id: PLATFORM_SETTING_ID },
    });
    if (existing !== null) {
      return existing.defaultDailySpendCapMicros;
    }
    try {
      const created = await this.prisma.platformSetting.create({
        data: {
          id: PLATFORM_SETTING_ID,
          defaultDailySpendCapMicros: DEFAULT_DAILY_SPEND_CAP_MICROS,
        },
      });
      return created.defaultDailySpendCapMicros;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const again = await this.prisma.platformSetting.findUnique({
        where: { id: PLATFORM_SETTING_ID },
      });
      return again?.defaultDailySpendCapMicros ?? DEFAULT_DAILY_SPEND_CAP_MICROS;
    }
  }
}
