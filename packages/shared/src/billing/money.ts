/** 1 USD. Balances and prices are integers in this unit. */
export const MICROS_PER_USD = 1_000_000n;

/** Computed customer prices round up to this step (0.0001 USD). */
export const PRICE_QUANTUM_MICROS = 100n;

/** Platform default until an operator changes the setting. 20 USD. */
export const DEFAULT_DAILY_SPEND_CAP_MICROS = 20_000_000n;

export const PLATFORM_SETTING_ID = 'platform';

export const MAX_MARKUP_PERCENT = 1000;

/** Largest single adjustment or cap an operator can type. 1,000,000 USD. */
export const MAX_MONEY_MICROS = 1_000_000n * MICROS_PER_USD;

export const MOCK_PROVIDER_CODE = 'mock';
export const MOCK_SEED_MARKUP_PERCENT = 50;
export const MOCK_SEED_COST_MICROS = 10_000n;
export const MOCK_SEED_MAX_TPS = 100;
export const MOCK_SEED_PRIORITY = 100;

/** Fictional NANP number (555-01xx). It is the platform shared sender, not a live line. */
export const PLATFORM_SENDER_VALUE = '12025550199';
export const PLATFORM_SENDER_LABEL = 'SMSVIO shared number';

export function effectiveDailySpendCap(
  organizationCap: bigint | null,
  platformCap: bigint,
): bigint {
  return organizationCap ?? platformCap;
}

/**
 * Customer price for one segment from a route cost and a markup percent.
 * Rounds up to the next 100 micros. Markup is a non-negative integer percent.
 */
export function quoteFromCost(costMicros: bigint, markupPercent: number): bigint {
  if (costMicros < 0n) {
    throw new Error('Route cost cannot be negative.');
  }
  if (!Number.isInteger(markupPercent) || markupPercent < 0 || markupPercent > MAX_MARKUP_PERCENT) {
    throw new Error('Markup percent is out of range.');
  }
  const product = costMicros * BigInt(100 + markupPercent);
  const steps = (product + 10_000n - 1n) / 10_000n;
  return steps * PRICE_QUANTUM_MICROS;
}

export function effectiveMarkup(
  providerPercent: number,
  routePercent: number | null,
): { percent: number; source: 'provider' | 'route' } {
  if (routePercent !== null) {
    return { percent: routePercent, source: 'route' };
  }
  return { percent: providerPercent, source: 'provider' };
}

export function marginMicros(priceMicros: bigint, costMicros: bigint): bigint {
  return priceMicros - costMicros;
}

/** Exact decimal USD with up to 6 places, or null when the text is not a money amount. */
export function parseUsdToMicros(value: string): bigint | null {
  const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(value.trim());
  const whole = match?.[1];
  const fraction = match?.[2] ?? '';
  if (whole === undefined) {
    return null;
  }
  const micros = BigInt(whole) * MICROS_PER_USD + BigInt(fraction.padEnd(6, '0'));
  if (micros > MAX_MONEY_MICROS) {
    return null;
  }
  return micros;
}

/** Display string. 2 decimals for balances, 4 for a per-segment price. Half away from zero. */
export function formatMicros(micros: bigint, fractionDigits: 2 | 4): string {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const factor = 10n ** BigInt(fractionDigits);
  const rounded = (absolute * factor + MICROS_PER_USD / 2n) / MICROS_PER_USD;
  const whole = rounded / factor;
  const fraction = (rounded % factor).toString().padStart(fractionDigits, '0');
  const text = `${whole.toString()}.${fraction}`;
  return negative ? `-${text}` : text;
}
