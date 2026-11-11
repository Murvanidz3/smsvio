import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@smsvio/db';
import { smsErrorMessage } from '@smsvio/shared';
import { ledgerDifferences } from '@smsvio/shared/billing';
import { PRISMA } from '@smsvio/server';

import { writeAudit } from '../accounts/support.js';
import type { ClientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { isUniqueViolation, presentMoney } from './present.js';

type Tx = Prisma.TransactionClient;

export interface LedgerRef {
  readonly type: string;
  readonly id: string;
}

/**
 * Available and held balances. The conditional update is the only place an amount is decided.
 * HOLD, CHARGE and RELEASE for the same refId run once; a repeat is a no-op.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async adjust(
    actorUserId: string,
    organizationId: string,
    input: { direction: 'credit' | 'debit'; amount: bigint; reason: string },
    client: ClientInfo,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (organization === null) {
      throw new ApiError(404, 'not_found', 'That organization does not exist.');
    }
    const signed = input.direction === 'credit' ? input.amount : -input.amount;
    const balance = await this.prisma.$transaction(async (tx) => {
      await ensureBalance(tx, organizationId);
      if (input.direction === 'debit') {
        const updated = await tx.orgBalance.updateMany({
          where: { organizationId, availableMicros: { gte: input.amount } },
          data: { availableMicros: { decrement: input.amount } },
        });
        if (updated.count !== 1) {
          throw new ApiError(402, 'insufficient_balance', smsErrorMessage('insufficient_balance'));
        }
      } else {
        await tx.orgBalance.updateMany({
          where: { organizationId },
          data: { availableMicros: { increment: input.amount } },
        });
      }
      const next = await readBalance(tx, organizationId);
      await tx.ledgerEntry.create({
        data: {
          organizationId,
          type: 'ADJUSTMENT',
          amountMicros: signed,
          balanceAfterMicros: next.availableMicros,
          refType: 'adjustment',
          note: input.reason,
        },
      });
      await writeAudit(tx, {
        organizationId,
        actorUserId,
        action: 'balance.adjust',
        targetType: 'organization',
        targetId: organizationId,
        meta: {
          direction: input.direction,
          amountMicros: input.amount.toString(),
          reason: input.reason,
        },
        ip: client.ip,
      });
      return next;
    });
    return {
      message:
        input.direction === 'credit'
          ? `Credited ${presentMoney(input.amount, 2).display} USD.`
          : `Debited ${presentMoney(input.amount, 2).display} USD.`,
      balance: {
        available: presentMoney(balance.availableMicros, 2),
        held: presentMoney(balance.heldMicros, 2),
      },
    };
  }

  async reserve(organizationId: string, amount: bigint, ref: LedgerRef, note: string) {
    requirePositive(amount);
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.ledgerEntry.findMany({
        where: { organizationId, refId: ref.id, type: { in: ['HOLD', 'CHARGE', 'RELEASE'] } },
      });
      if (prior.some((row) => row.type === 'CHARGE' || row.type === 'RELEASE')) {
        throw settled();
      }
      if (prior.some((row) => row.type === 'HOLD')) {
        return readBalance(tx, organizationId);
      }
      await ensureBalance(tx, organizationId);
      const updated = await tx.orgBalance.updateMany({
        where: { organizationId, availableMicros: { gte: amount } },
        data: {
          availableMicros: { decrement: amount },
          heldMicros: { increment: amount },
        },
      });
      if (updated.count !== 1) {
        throw new ApiError(402, 'insufficient_balance', smsErrorMessage('insufficient_balance'));
      }
      const next = await readBalance(tx, organizationId);
      await tx.ledgerEntry.create({
        data: {
          organizationId,
          type: 'HOLD',
          amountMicros: -amount,
          balanceAfterMicros: next.availableMicros,
          refType: ref.type,
          refId: ref.id,
          note,
        },
      });
      return next;
    });
  }

  async charge(organizationId: string, amount: bigint, ref: LedgerRef, note: string) {
    requirePositive(amount);
    return this.moveHeld(organizationId, amount, ref, 'CHARGE', note);
  }

  async release(organizationId: string, amount: bigint, ref: LedgerRef, note: string) {
    requirePositive(amount);
    return this.moveHeld(organizationId, amount, ref, 'RELEASE', note);
  }

  async differences() {
    const [balances, entries] = await Promise.all([
      this.prisma.orgBalance.findMany(),
      this.prisma.ledgerEntry.findMany(),
    ]);
    return {
      differences: ledgerDifferences(
        balances.map((row) => ({
          organizationId: row.organizationId,
          availableMicros: row.availableMicros,
          heldMicros: row.heldMicros,
        })),
        entries.map((row) => ({
          organizationId: row.organizationId,
          type: row.type,
          amountMicros: row.amountMicros,
          refId: row.refId,
        })),
      ).map((row) => ({
        organizationId: row.organizationId,
        availableMicros: row.availableMicros.toString(),
        heldMicros: row.heldMicros.toString(),
        ledgerAvailableMicros: row.ledgerAvailableMicros.toString(),
        ledgerHeldMicros: row.ledgerHeldMicros.toString(),
      })),
    };
  }

  private async moveHeld(
    organizationId: string,
    amount: bigint,
    ref: LedgerRef,
    type: 'CHARGE' | 'RELEASE',
    note: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findFirst({
        where: { organizationId, refId: ref.id, type: { in: ['CHARGE', 'RELEASE'] } },
      });
      if (existing?.type === type) {
        return readBalance(tx, organizationId);
      }
      if (existing !== null) {
        throw settled();
      }
      const hold = await tx.ledgerEntry.findFirst({
        where: { organizationId, refId: ref.id, type: 'HOLD' },
      });
      if (hold?.amountMicros !== -amount) {
        throw new ApiError(409, 'hold_missing', 'There is no matching reservation to settle.');
      }
      const updated =
        type === 'CHARGE'
          ? await tx.orgBalance.updateMany({
              where: { organizationId, heldMicros: { gte: amount } },
              data: { heldMicros: { decrement: amount } },
            })
          : await tx.orgBalance.updateMany({
              where: { organizationId, heldMicros: { gte: amount } },
              data: {
                heldMicros: { decrement: amount },
                availableMicros: { increment: amount },
              },
            });
      if (updated.count !== 1) {
        throw new ApiError(409, 'hold_missing', 'There is no matching reservation to settle.');
      }
      const next = await readBalance(tx, organizationId);
      await tx.ledgerEntry.create({
        data: {
          organizationId,
          type,
          amountMicros: type === 'CHARGE' ? -amount : amount,
          balanceAfterMicros: next.availableMicros,
          refType: ref.type,
          refId: ref.id,
          note,
        },
      });
      return next;
    });
  }
}

function requirePositive(amount: bigint): void {
  if (amount <= 0n) {
    throw new ApiError(400, 'validation_error', 'The amount has to be greater than zero.');
  }
}

function settled(): ApiError {
  return new ApiError(409, 'balance_settled', 'That reservation is already settled.');
}

async function ensureBalance(tx: Tx, organizationId: string): Promise<void> {
  const existing = await tx.orgBalance.findUnique({ where: { organizationId } });
  if (existing !== null) {
    return;
  }
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

async function readBalance(tx: Tx, organizationId: string) {
  const row = await tx.orgBalance.findUnique({ where: { organizationId } });
  if (row === null) {
    throw new Error(`Balance for ${organizationId} was not stored.`);
  }
  return { availableMicros: row.availableMicros, heldMicros: row.heldMicros };
}
