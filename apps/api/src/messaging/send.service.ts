import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import {
  IDEMPOTENCY_TTL_MS,
  SEND_QUEUE_KEY,
  analyzeMessage,
  checkSender,
  renderTemplate,
  smsErrorMessage,
  spendAllowed,
  templateCanBeSent,
  type SmsErrorCode,
} from '@smsvio/shared';
import {
  DEFAULT_DAILY_SPEND_CAP_MICROS,
  PLATFORM_SETTING_ID,
  configuredSharedSender,
  effectiveDailySpendCap,
} from '@smsvio/shared/billing';
import { normalizePhone } from '@smsvio/shared/phone';
import { PRISMA, REDIS } from '@smsvio/server';
import type { Redis } from 'ioredis';

import type { AuthState } from '../accounts/support.js';
import { assertCapability } from '../accounts/support.js';
import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { ApiError } from '../http/api-error.js';
import { isUniqueViolation, presentMoney } from './present.js';
import { PricingService } from './pricing.service.js';

interface SendInput {
  readonly templateId: string;
  readonly variables?: Readonly<Record<string, string>>;
  readonly to?: string;
  readonly country?: string;
  readonly contactId?: string;
  readonly senderId?: string | null;
  readonly clientRef?: string;
}

interface Prepared {
  readonly to: string;
  readonly from: string;
  readonly countryIso2: string;
  readonly body: string;
  readonly encoding: string;
  readonly segments: number;
  readonly templateId: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly price: bigint;
}

@Injectable()
export class SendService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly pricing: PricingService,
    @Optional() @Inject(API_ENV) private readonly env?: ApiEnv,
  ) {}

  async preview(state: AuthState, input: SendInput) {
    assertCapability(state, 'messaging');
    const prepared = await this.prepare(state, input);
    return presentPrepared(prepared);
  }

  async send(state: AuthState, input: SendInput) {
    assertCapability(state, 'messaging');
    const organizationId = state.organizationId;
    if (input.clientRef !== undefined) {
      const prior = await this.prisma.message.findFirst({
        where: { organizationId, clientRef: input.clientRef },
      });
      if (prior !== null && Date.now() - prior.createdAt.getTime() < IDEMPOTENCY_TTL_MS) {
        return presentAccepted(prior);
      }
    }
    const prepared = await this.prepare(state, input);
    await this.takeRateSlot(organizationId);
    const spent = await this.spentToday(organizationId);
    const cap = await this.spendCap(organizationId);
    if (!spendAllowed(spent, prepared.price, cap)) {
      throw sms('spend_cap_reached');
    }
    const id = randomUUID();
    const queuedAt = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        if (input.clientRef !== undefined) {
          const prior = await tx.message.findFirst({
            where: { organizationId, clientRef: input.clientRef },
          });
          if (prior !== null && Date.now() - prior.createdAt.getTime() < IDEMPOTENCY_TTL_MS) {
            throw new ApiError(409, 'replay', prior.id);
          }
          if (prior !== null) {
            await tx.message.update({ where: { id: prior.id }, data: { clientRef: null } });
          }
        }
        const balanceRow = await tx.orgBalance.findUnique({ where: { organizationId } });
        if (balanceRow === null) {
          try {
            await tx.orgBalance.create({
              data: { organizationId, availableMicros: 0n, heldMicros: 0n },
            });
          } catch (error) {
            if (!isUniqueViolation(error)) {
              throw error;
            }
          }
        }
        const updated = await tx.orgBalance.updateMany({
          where: { organizationId, availableMicros: { gte: prepared.price } },
          data: {
            availableMicros: { decrement: prepared.price },
            heldMicros: { increment: prepared.price },
          },
        });
        if (updated.count !== 1) {
          throw sms('insufficient_balance', 402);
        }
        const balance = await tx.orgBalance.findUnique({ where: { organizationId } });
        await tx.ledgerEntry.create({
          data: {
            organizationId,
            type: 'HOLD',
            amountMicros: -prepared.price,
            balanceAfterMicros: balance?.availableMicros ?? 0n,
            refType: 'message',
            refId: id,
            note: 'Message queued',
          },
        });
        await tx.message.create({
          data: {
            id,
            organizationId,
            direction: 'OUTBOUND',
            to: prepared.to,
            fromSender: prepared.from,
            body: prepared.body,
            templateId: prepared.templateId,
            templateVars: prepared.variables,
            encoding: prepared.encoding,
            segments: prepared.segments,
            countryIso2: prepared.countryIso2,
            status: 'QUEUED',
            priceMicros: prepared.price,
            clientRef: input.clientRef ?? null,
            userId: state.userId,
            queuedAt,
          },
        });
        await tx.messageEvent.create({
          data: { messageId: id, status: 'QUEUED', detail: 'Accepted.' },
        });
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'replay' && input.clientRef !== undefined) {
        const prior = await this.prisma.message.findFirst({
          where: { organizationId, clientRef: input.clientRef },
        });
        if (prior !== null) {
          return presentAccepted(prior);
        }
      }
      throw error;
    }
    await this.redis.lpush(SEND_QUEUE_KEY, id);
    const stored = await this.prisma.message.findUnique({ where: { id } });
    if (stored === null) {
      throw sms('internal_error', 500);
    }
    return presentAccepted(stored);
  }

  private async prepare(state: AuthState, input: SendInput): Promise<Prepared> {
    assertCapability(state, 'messaging');
    const organizationId = state.organizationId;
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (organization === null) {
      throw sms('internal_error', 500);
    }
    if (organization.status === 'SUSPENDED') {
      throw sms('organization_suspended');
    }
    const destination = await this.destination(organizationId, input);
    if (organization.status !== 'ACTIVE') {
      const user = await this.prisma.user.findUnique({ where: { id: state.userId } });
      if (
        user?.accountPhoneVerifiedAt === null ||
        user?.accountPhoneVerifiedAt === undefined ||
        user.accountPhoneE164 !== destination.to
      ) {
        throw sms('organization_not_verified');
      }
    }
    const contact = await this.prisma.contact.findFirst({
      where: { organizationId, phoneE164: destination.to, optedOut: true },
    });
    if (contact !== null) {
      throw sms('recipient_opted_out');
    }
    const template = await this.prisma.template.findFirst({
      where: { id: input.templateId, organizationId },
    });
    if (template === null || !templateCanBeSent(template.status)) {
      throw sms('template_not_approved');
    }
    const rendered = renderTemplate(template.body, input.variables ?? {});
    if (!rendered.ok) {
      throw sms('missing_variable');
    }
    const analysis = analyzeMessage(rendered.text, { smartEncoding: organization.smartEncoding });
    if (analysis.tooLong) {
      throw sms('message_too_long');
    }
    const sender = await this.sender(organizationId, destination.countryIso2, input.senderId);
    const quote = await this.pricing.quoteOne(organizationId, destination.countryIso2, null);
    if (quote === null || quote.micros <= 0n) {
      throw sms('no_route');
    }
    return {
      to: destination.to,
      from: sender,
      countryIso2: destination.countryIso2,
      body: analysis.text,
      encoding: analysis.encoding,
      segments: analysis.segmentCount,
      templateId: template.id,
      variables: input.variables ?? {},
      price: quote.micros * BigInt(analysis.segmentCount),
    };
  }

  private async destination(
    organizationId: string,
    input: SendInput,
  ): Promise<{ to: string; countryIso2: string }> {
    let raw = input.to;
    let country = input.country;
    if (input.contactId !== undefined) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: input.contactId, organizationId },
      });
      if (contact === null) {
        throw new ApiError(404, 'not_found', 'That contact does not exist.');
      }
      raw = contact.phoneE164;
      country = contact.countryCode;
    }
    if (raw === undefined) {
      throw sms('invalid_number');
    }
    const phone = normalizePhone(raw, country);
    if (!phone.ok) {
      throw sms('invalid_number');
    }
    const countryIso2 = phone.phone.countryCode;
    const enabled = await this.prisma.orgCountry.findFirst({
      where: { organizationId, countryIso2 },
    });
    const directory = await this.prisma.country.findUnique({ where: { iso2: countryIso2 } });
    if (directory?.enabled !== true) {
      throw sms('country_not_supported');
    }
    if (enabled === null) {
      throw sms('country_not_enabled');
    }
    if (directory.registrationRequired && !enabled.registrationComplete) {
      throw sms('registration_required');
    }
    return { to: phone.phone.e164, countryIso2 };
  }

  private async sender(
    organizationId: string,
    countryIso2: string,
    requested: string | null | undefined,
  ): Promise<string> {
    const destination = await this.prisma.orgCountry.findFirst({
      where: { organizationId, countryIso2 },
    });
    const country = await this.prisma.country.findUnique({ where: { iso2: countryIso2 } });
    const senderId = requested === undefined ? (destination?.senderIdId ?? null) : requested;
    if (senderId === null) {
      const setting = await this.prisma.platformSetting.findUnique({
        where: { id: PLATFORM_SETTING_ID },
      });
      const shared = configuredSharedSender(setting?.sharedSender);
      if (shared === null) {
        throw sms('invalid_sender');
      }
      return shared;
    }
    const sender = await this.prisma.senderId.findFirst({
      where: { id: senderId, organizationId, status: 'APPROVED' },
    });
    if (sender === null) {
      throw sms('sender_not_approved');
    }
    const checked = checkSender(sender.value, {
      alphanumericAllowed: country?.alphaSenderAllowed !== false,
    });
    if (!checked.ok) {
      throw sms('invalid_sender');
    }
    return sender.value;
  }

  private async takeRateSlot(organizationId: string): Promise<void> {
    const second = Math.floor(Date.now() / 1000);
    const key = `smsvio:rate:send:${organizationId}:${String(second)}`;
    const used = await this.redis.incr(key);
    if (used === 1) {
      await this.redis.expire(key, 2);
    }
    const limit = this.env?.ORG_SENDS_PER_SECOND ?? 20;
    if (used > limit) {
      throw new ApiError(429, 'rate_limited', smsErrorMessage('rate_limited'), undefined, 1);
    }
  }

  private async spentToday(organizationId: string): Promise<bigint> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const rows = await this.prisma.message.findMany({
      where: { organizationId, createdAt: { gte: start } },
    });
    return rows.reduce((sum, row) => {
      if (row.status === 'FAILED' || row.status === 'REJECTED' || row.priceMicros === null) {
        return sum;
      }
      return sum + row.priceMicros;
    }, 0n);
  }

  private async spendCap(organizationId: string): Promise<bigint> {
    const [organization, setting] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.platformSetting.findUnique({ where: { id: PLATFORM_SETTING_ID } }),
    ]);
    return effectiveDailySpendCap(
      organization?.dailySpendCapMicros ?? null,
      setting?.defaultDailySpendCapMicros ?? DEFAULT_DAILY_SPEND_CAP_MICROS,
    );
  }
}

function sms(code: SmsErrorCode, status = 400): ApiError {
  return new ApiError(status, code, smsErrorMessage(code));
}

function presentPrepared(prepared: Prepared) {
  return {
    to: prepared.to,
    from: prepared.from,
    countryIso2: prepared.countryIso2,
    encoding: prepared.encoding,
    segments: prepared.segments,
    body: prepared.body,
    price: presentMoney(prepared.price, 4),
  };
}

function presentAccepted(message: {
  id: string;
  status: string;
  to: string;
  fromSender: string;
  segments: number;
  encoding: string;
  priceMicros: bigint | null;
}) {
  return {
    id: message.id,
    status: message.status.toLowerCase(),
    to: message.to,
    from: message.fromSender,
    encoding: message.encoding,
    segments: message.segments,
    price: presentMoney(message.priceMicros ?? 0n, 4),
    message: 'Message queued.',
  };
}
