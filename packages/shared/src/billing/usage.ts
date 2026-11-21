import { MICROS_PER_USD } from './money.js';

/** Background rollup interval. Opening Overview counts the organization immediately. */
export const USAGE_REFRESH_MS = 15 * 60 * 1000;

/** Smallest card top-up. Charging waits until a payment provider is configured. */
export const MIN_TOP_UP_MICROS = 10n * MICROS_PER_USD;

const ACCEPTED = new Set(['SENT', 'DELIVERED', 'UNDELIVERED', 'EXPIRED']);
const FAILED = new Set(['FAILED', 'REJECTED', 'UNDELIVERED', 'BLOCKED']);
const FINAL = new Set(['DELIVERED', 'UNDELIVERED', 'EXPIRED', 'FAILED', 'REJECTED', 'BLOCKED']);

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageMessage {
  readonly createdAt: Date;
  readonly status: string;
  readonly priceMicros: bigint | null;
  readonly billable: boolean;
}

export interface UsageDay {
  readonly day: string;
  readonly sent: number;
  readonly delivered: number;
  readonly failed: number;
  readonly finalCount: number;
  readonly spendMicros: bigint;
}

export type OverviewRange = 'today' | '7' | '30' | '90' | 'custom';

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Inclusive UTC window. A custom range must be ordered, not in the future, and at most 90 days.
 */
export function usageWindow(
  range: OverviewRange,
  now: Date,
  from?: string,
  to?: string,
): { start: Date; days: number } | { error: string } {
  const today = startOfUtcDay(now);
  if (range !== 'custom') {
    const days = range === 'today' ? 1 : Number(range);
    return { start: new Date(today.getTime() - (days - 1) * DAY_MS), days };
  }
  if (from === undefined || to === undefined) {
    return { error: 'Choose a start and end date.' };
  }
  const start = parseDay(from);
  const end = parseDay(to);
  if (start === null || end === null) {
    return { error: 'Use dates as YYYY-MM-DD.' };
  }
  if (end.getTime() < start.getTime()) {
    return { error: 'The end date is before the start date.' };
  }
  if (end.getTime() > today.getTime()) {
    return { error: 'The end date cannot be in the future.' };
  }
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days > 90) {
    return { error: 'Choose a range of 90 days or fewer.' };
  }
  return { start, days };
}

export function summarizeUsage(
  messages: readonly UsageMessage[],
  start: Date,
  days: number,
): UsageDay[] {
  const buckets = new Map<string, UsageDay>();
  for (let index = 0; index < days; index += 1) {
    const day = utcDay(new Date(start.getTime() + index * DAY_MS));
    buckets.set(day, {
      day,
      sent: 0,
      delivered: 0,
      failed: 0,
      finalCount: 0,
      spendMicros: 0n,
    });
  }
  for (const message of messages) {
    const bucket = buckets.get(utcDay(message.createdAt));
    if (bucket === undefined) {
      continue;
    }
    const next = applyMessage(bucket, message);
    buckets.set(bucket.day, next);
  }
  return [...buckets.values()];
}

/** Delivered divided by messages that have a final status. Null when none have finished. */
export function deliverability(days: readonly UsageDay[]): number | null {
  let delivered = 0;
  let finalCount = 0;
  for (const day of days) {
    delivered += day.delivered;
    finalCount += day.finalCount;
  }
  if (finalCount === 0) {
    return null;
  }
  return delivered / finalCount;
}

export interface EstimateDestination {
  readonly country: string;
  readonly sharePercent: number;
  readonly priceMicros: bigint;
}

export interface EstimateLine {
  readonly country: string;
  readonly messages: number;
  readonly segments: number;
  readonly priceMicros: bigint;
  readonly costMicros: bigint;
}

export function estimateMonthlyBill(input: {
  monthlyMessages: number;
  segments: number;
  destinations: readonly EstimateDestination[];
}): { lines: EstimateLine[]; totalMicros: bigint } | { error: string } {
  if (
    !Number.isInteger(input.monthlyMessages) ||
    input.monthlyMessages < 0 ||
    input.monthlyMessages > 100_000_000
  ) {
    return { error: 'Enter a monthly message count from 0 to 100000000.' };
  }
  if (!Number.isInteger(input.segments) || input.segments < 1 || input.segments > 10) {
    return { error: 'Average segments must be from 1 to 10.' };
  }
  if (input.destinations.length === 0) {
    return { error: 'Add at least one destination.' };
  }
  let share = 0;
  for (const destination of input.destinations) {
    if (
      !Number.isInteger(destination.sharePercent) ||
      destination.sharePercent < 0 ||
      destination.sharePercent > 100
    ) {
      return { error: 'Each share is a whole percent from 0 to 100.' };
    }
    share += destination.sharePercent;
  }
  if (share !== 100) {
    return { error: 'Destination shares must total 100%.' };
  }
  let totalMicros = 0n;
  const lines = input.destinations.map((destination) => {
    const messages = Math.floor((input.monthlyMessages * destination.sharePercent) / 100);
    const costMicros = destination.priceMicros * BigInt(messages) * BigInt(input.segments);
    totalMicros += costMicros;
    return {
      country: destination.country,
      messages,
      segments: input.segments,
      priceMicros: destination.priceMicros,
      costMicros,
    };
  });
  return { lines, totalMicros };
}

export interface RechargeProfile {
  readonly autoRechargeEnabled: boolean;
  readonly autoRechargeThresholdMicros: bigint | null;
  readonly autoRechargeAmountMicros: bigint | null;
}

/**
 * Auto-recharge is stored now and is not charged. There is no payment provider to debit a saved card.
 */
export function autoRechargeAction(
  profile: RechargeProfile,
  availableMicros: bigint,
): 'idle' | 'below_threshold' {
  if (!profile.autoRechargeEnabled) {
    return 'idle';
  }
  if (
    profile.autoRechargeThresholdMicros === null ||
    profile.autoRechargeAmountMicros === null ||
    availableMicros >= profile.autoRechargeThresholdMicros
  ) {
    return 'idle';
  }
  return 'below_threshold';
}

function applyMessage(bucket: UsageDay, message: UsageMessage): UsageDay {
  const accepted = ACCEPTED.has(message.status);
  const spend =
    accepted && message.billable && message.priceMicros !== null
      ? bucket.spendMicros + message.priceMicros
      : bucket.spendMicros;
  return {
    day: bucket.day,
    sent: bucket.sent + (accepted ? 1 : 0),
    delivered: bucket.delivered + (message.status === 'DELIVERED' ? 1 : 0),
    failed: bucket.failed + (FAILED.has(message.status) ? 1 : 0),
    finalCount: bucket.finalCount + (FINAL.has(message.status) ? 1 : 0),
    spendMicros: spend,
  };
}

function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || utcDay(parsed) !== value) {
    return null;
  }
  return parsed;
}
