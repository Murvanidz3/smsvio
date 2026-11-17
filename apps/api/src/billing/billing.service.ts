import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import {
  MIN_TOP_UP_MICROS,
  autoRechargeAction,
  deliverability,
  formatMicros,
  parseUsdToMicros,
  summarizeUsage,
  usageWindow,
  type OverviewRange,
} from '@smsvio/shared/billing';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertCapability, writeAudit } from '../accounts/support.js';
import type { ClientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { presentMoney, validation } from '../messaging/present.js';
import { PricingService } from '../messaging/pricing.service.js';

interface PreferenceInput {
  email?: string | null;
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryIso2?: string | null;
  lowBalance?: string | null;
  autoRechargeEnabled?: boolean;
  autoRechargeThreshold?: string | null;
  autoRechargeAmount?: string | null;
}

const LEDGER_LABEL: Record<string, string> = {
  TOPUP: 'Top-up',
  HOLD: 'Hold',
  CHARGE: 'Charge',
  RELEASE: 'Release',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
};

@Injectable()
export class BillingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly pricing: PricingService,
  ) {}

  async overview(state: AuthState, query: { range: OverviewRange; from?: string; to?: string }) {
    assertCapability(state, 'view');
    const organizationId = state.organizationId;
    const window = usageWindow(query.range, new Date(), query.from, query.to);
    if ('error' in window) {
      throw validation({ range: window.error });
    }
    const [organization, templates, contacts, recent, balance, messages, countries] =
      await Promise.all([
        this.prisma.organization.findUnique({ where: { id: organizationId } }),
        this.prisma.template.count({ where: { organizationId } }),
        this.prisma.contact.count({ where: { organizationId } }),
        this.prisma.contact.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.prisma.orgBalance.findUnique({ where: { organizationId } }),
        this.prisma.message.findMany({
          where: { organizationId, createdAt: { gte: window.start } },
          select: { createdAt: true, status: true, priceMicros: true, billable: true },
        }),
        this.prisma.country.findMany(),
      ]);
    if (organization === null) {
      throw new ApiError(404, 'not_found', 'That organization does not exist.');
    }
    const days = summarizeUsage(messages, window.start, window.days);
    const dials = new Map(countries.map((country) => [country.iso2, country.dialCode]));
    const ratio = deliverability(days);
    return {
      verification: organization.status,
      templates,
      contacts,
      deliverability: ratio === null ? null : Math.round(ratio * 1000) / 1000,
      balance: {
        available: presentMoney(balance?.availableMicros ?? 0n, 2),
        held: presentMoney(balance?.heldMicros ?? 0n, 2),
      },
      totals: {
        sent: days.reduce((sum, day) => sum + day.sent, 0),
        delivered: days.reduce((sum, day) => sum + day.delivered, 0),
        failed: days.reduce((sum, day) => sum + day.failed, 0),
        spend: presentMoney(
          days.reduce((sum, day) => sum + day.spendMicros, 0n),
          2,
        ),
      },
      days: days.map((day) => ({
        day: day.day,
        sent: day.sent,
        delivered: day.delivered,
        failed: day.failed,
        spend: presentMoney(day.spendMicros, 2),
      })),
      recentContacts: recent.map((contact) => ({
        id: contact.id,
        phone: contact.phoneE164,
        country: contact.countryCode,
        dialCode: dials.get(contact.countryCode) ?? '',
        optedOut: contact.optedOut,
      })),
    };
  }

  async billing(state: AuthState) {
    assertCapability(state, 'billing');
    const [balance, profile] = await Promise.all([
      this.prisma.orgBalance.findUnique({ where: { organizationId: state.organizationId } }),
      this.prisma.billingProfile.findUnique({ where: { organizationId: state.organizationId } }),
    ]);
    return {
      balance: {
        available: presentMoney(balance?.availableMicros ?? 0n, 2),
        held: presentMoney(balance?.heldMicros ?? 0n, 2),
      },
      payments: 'unconfigured' as const,
      preferences: presentProfile(profile),
      autoRecharge: autoRechargeAction(
        {
          autoRechargeEnabled: profile?.autoRechargeEnabled ?? false,
          autoRechargeThresholdMicros: profile?.autoRechargeThresholdMicros ?? null,
          autoRechargeAmountMicros: profile?.autoRechargeAmountMicros ?? null,
        },
        balance?.availableMicros ?? 0n,
      ),
    };
  }

  async updatePreferences(state: AuthState, input: PreferenceInput, client: ClientInfo) {
    assertCapability(state, 'billing');
    const organizationId = state.organizationId;
    const current = await this.prisma.billingProfile.findUnique({ where: { organizationId } });
    const enabled = input.autoRechargeEnabled ?? current?.autoRechargeEnabled ?? false;
    const threshold = moneyField(
      input.autoRechargeThreshold,
      current?.autoRechargeThresholdMicros ?? null,
      'autoRechargeThreshold',
    );
    const amount = moneyField(
      input.autoRechargeAmount,
      current?.autoRechargeAmountMicros ?? null,
      'autoRechargeAmount',
    );
    if (enabled && (threshold === null || amount === null || amount < MIN_TOP_UP_MICROS)) {
      throw validation({
        autoRechargeAmount: 'Auto-recharge needs a threshold and an amount of at least 10 USD.',
      });
    }
    const lowBalance = moneyField(
      input.lowBalance,
      current?.lowBalanceMicros ?? null,
      'lowBalance',
    );
    const email = emailField(input.email, current?.email ?? null);
    const data = {
      email,
      name: textField(input.name, current?.name ?? null),
      line1: textField(input.line1, current?.line1 ?? null),
      line2: textField(input.line2, current?.line2 ?? null),
      city: textField(input.city, current?.city ?? null),
      region: textField(input.region, current?.region ?? null),
      postalCode: textField(input.postalCode, current?.postalCode ?? null),
      countryIso2:
        input.countryIso2 === undefined ? (current?.countryIso2 ?? null) : input.countryIso2,
      lowBalanceMicros: lowBalance,
      autoRechargeEnabled: enabled,
      autoRechargeThresholdMicros: threshold,
      autoRechargeAmountMicros: amount,
    };
    const saved = await this.prisma.billingProfile.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    await writeAudit(this.prisma, {
      organizationId,
      actorUserId: state.userId,
      action: 'billing.preferences',
      targetType: 'organization',
      targetId: organizationId,
      ip: client.ip,
      meta: { autoRecharge: String(saved.autoRechargeEnabled) },
    });
    return presentProfile(saved);
  }

  async history(state: AuthState, query: { page: number; pageSize: number }) {
    assertCapability(state, 'billing');
    const where = { organizationId: state.organizationId };
    const [total, rows] = await Promise.all([
      this.prisma.ledgerEntry.count({ where }),
      this.prisma.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        description:
          row.note !== null && row.note !== '' ? row.note : (LEDGER_LABEL[row.type] ?? row.type),
        status: 'posted',
        amount: presentMoney(row.amountMicros, 2),
        balanceAfter: presentMoney(row.balanceAfterMicros, 2),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async receipt(state: AuthState, id: string): Promise<string> {
    assertCapability(state, 'billing');
    const row = await this.prisma.ledgerEntry.findFirst({
      where: { id, organizationId: state.organizationId },
    });
    if (row === null) {
      throw new ApiError(404, 'not_found', 'That ledger entry does not exist.');
    }
    const lines = [
      'SMSVIO receipt',
      `Entry: ${row.id}`,
      `Type: ${LEDGER_LABEL[row.type] ?? row.type}`,
      `Amount: ${formatMicros(row.amountMicros, 2)} USD`,
      `Balance after: ${formatMicros(row.balanceAfterMicros, 2)} USD`,
      `Date: ${row.createdAt.toISOString()}`,
    ];
    if (row.note !== null && row.note !== '') {
      lines.push(`Note: ${row.note}`);
    }
    return lines.join('\n');
  }

  requestTopUp(state: AuthState, amount: string): never {
    assertCapability(state, 'billing');
    const micros = parseUsdToMicros(amount);
    if (micros === null || micros < MIN_TOP_UP_MICROS) {
      throw validation({ amount: 'The minimum top-up is 10 USD.' });
    }
    throw new ApiError(
      503,
      'payments_unconfigured',
      'Online checkout is not configured. No payment provider has been connected, so this did not charge a card or credit the balance.',
    );
  }

  async rates(state: AuthState) {
    assertCapability(state, 'view');
    const [prices, countries] = await Promise.all([
      this.pricing.quoteMap(state.organizationId),
      this.prisma.country.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      items: countries.flatMap((country) => {
        const quote = prices.get(country.iso2);
        if (quote === undefined) {
          return [];
        }
        return [
          {
            country: country.iso2,
            name: country.name,
            dialCode: country.dialCode,
            price: presentMoney(quote.micros, 4),
          },
        ];
      }),
    };
  }
}

function presentProfile(
  profile: {
    email: string | null;
    name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    countryIso2: string | null;
    lowBalanceMicros: bigint | null;
    autoRechargeEnabled: boolean;
    autoRechargeThresholdMicros: bigint | null;
    autoRechargeAmountMicros: bigint | null;
  } | null,
) {
  return {
    email: profile?.email ?? '',
    name: profile?.name ?? '',
    line1: profile?.line1 ?? '',
    line2: profile?.line2 ?? '',
    city: profile?.city ?? '',
    region: profile?.region ?? '',
    postalCode: profile?.postalCode ?? '',
    countryIso2: profile?.countryIso2 ?? '',
    lowBalance:
      profile?.lowBalanceMicros === undefined || profile.lowBalanceMicros === null
        ? ''
        : formatMicros(profile.lowBalanceMicros, 2),
    autoRechargeEnabled: profile?.autoRechargeEnabled ?? false,
    autoRechargeThreshold:
      profile?.autoRechargeThresholdMicros === undefined ||
      profile.autoRechargeThresholdMicros === null
        ? ''
        : formatMicros(profile.autoRechargeThresholdMicros, 2),
    autoRechargeAmount:
      profile?.autoRechargeAmountMicros === undefined || profile.autoRechargeAmountMicros === null
        ? ''
        : formatMicros(profile.autoRechargeAmountMicros, 2),
  };
}

function textField(next: string | null | undefined, current: string | null): string | null {
  if (next === undefined) {
    return current;
  }
  const trimmed = next?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function emailField(next: string | null | undefined, current: string | null): string | null {
  const value = textField(next, current);
  if (value !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw validation({ email: 'Enter a valid email address.' });
  }
  return value?.toLowerCase() ?? null;
}

function moneyField(
  next: string | null | undefined,
  current: bigint | null,
  field: string,
): bigint | null {
  if (next === undefined) {
    return current;
  }
  if (next === null || next.trim() === '') {
    return null;
  }
  const micros = parseUsdToMicros(next);
  if (micros === null || micros <= 0n) {
    throw validation({ [field]: 'Enter an amount greater than 0 and at most 1000000 USD.' });
  }
  return micros;
}
