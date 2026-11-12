import { describe, expect, it } from 'vitest';

import { ledgerDifferences } from './ledger.js';
import {
  DEFAULT_DAILY_SPEND_CAP_MICROS,
  effectiveDailySpendCap,
  effectiveMarkup,
  configuredSharedSender,
  formatMicros,
  marginMicros,
  parseUsdToMicros,
  quoteFromCost,
} from './money.js';
import { currentFixedPrice, resolveCustomerPrice, selectPrimaryRoute } from './pricing.js';
import { parseRateCsv } from './rates-csv.js';
import {
  adminListSchema,
  createProviderSchema,
  platformSettingsSchema,
  requestSenderSchema,
} from './schemas.js';

describe('customer price', () => {
  it('hides a blank shared sender and checks the settings body', () => {
    expect(configuredSharedSender(null)).toBeNull();
    expect(configuredSharedSender('  ')).toBeNull();
    expect(configuredSharedSender('12025550199')).toBe('12025550199');
    expect(platformSettingsSchema.parse({ sharedSender: '' })).toEqual({ sharedSender: '' });
    expect(platformSettingsSchema.safeParse({}).success).toBe(false);
    expect(platformSettingsSchema.safeParse({ sharedSender: '123' }).success).toBe(false);
  });

  it('marks up the route cost and rounds up to 100 micros', () => {
    expect(quoteFromCost(10_000n, 50)).toBe(15_000n);
    expect(quoteFromCost(10_000n, 0)).toBe(10_000n);
    expect(quoteFromCost(10_001n, 0)).toBe(10_100n);
    expect(quoteFromCost(1n, 0)).toBe(100n);
    expect(quoteFromCost(0n, 50)).toBe(0n);
    expect(quoteFromCost(10_000n, 1000)).toBe(110_000n);
  });

  it('rejects a negative cost or a markup outside 0–1000', () => {
    expect(() => quoteFromCost(-1n, 0)).toThrow(/cost/);
    expect(() => quoteFromCost(1n, -1)).toThrow(/Markup/);
    expect(() => quoteFromCost(1n, 1001)).toThrow(/Markup/);
    expect(() => quoteFromCost(1n, 1.5)).toThrow(/Markup/);
  });

  it('uses the route override when one is set', () => {
    expect(effectiveMarkup(50, null)).toEqual({ percent: 50, source: 'provider' });
    expect(effectiveMarkup(50, 10)).toEqual({ percent: 10, source: 'route' });
    expect(effectiveMarkup(50, 0)).toEqual({ percent: 0, source: 'route' });
  });

  it('keeps margin as price minus the route cost, which may be negative', () => {
    expect(marginMicros(15_000n, 10_000n)).toBe(5_000n);
    expect(marginMicros(1_000n, 10_000n)).toBe(-9_000n);
  });

  it('picks the most specific enabled route, then the best priority and weight', () => {
    const routes = [
      { id: 'b', countryIso2: 'US', mccmnc: null, priority: 10, weight: 1, enabled: true },
      { id: 'a', countryIso2: 'US', mccmnc: null, priority: 10, weight: 5, enabled: true },
      { id: 'c', countryIso2: 'US', mccmnc: '310260', priority: 50, weight: 1, enabled: true },
      { id: 'd', countryIso2: 'US', mccmnc: null, priority: 1, weight: 1, enabled: false },
      { id: 'e', countryIso2: 'GB', mccmnc: null, priority: 1, weight: 1, enabled: true },
      { id: 'f', countryIso2: 'US', mccmnc: null, priority: 30, weight: 9, enabled: true },
    ];
    expect(selectPrimaryRoute(routes, 'US', null)?.id).toBe('a');
    expect(selectPrimaryRoute(routes, 'US', '310260')?.id).toBe('c');
    expect(selectPrimaryRoute(routes, 'US', '999999')?.id).toBe('a');
    expect(selectPrimaryRoute(routes, 'FR', null)).toBeNull();
    expect(selectPrimaryRoute([], 'US', null)).toBeNull();
  });

  it('breaks a full tie by id', () => {
    const routes = [
      { id: 'm', countryIso2: 'DE', mccmnc: null, priority: 1, weight: 1, enabled: true },
      { id: 'a', countryIso2: 'DE', mccmnc: null, priority: 1, weight: 1, enabled: true },
    ];
    expect(selectPrimaryRoute(routes, 'DE', null)?.id).toBe('a');
    expect(
      selectPrimaryRoute(
        [
          { id: 'same', countryIso2: 'DE', mccmnc: null, priority: 1, weight: 1, enabled: true },
          { id: 'same', countryIso2: 'DE', mccmnc: null, priority: 1, weight: 1, enabled: true },
        ],
        'DE',
        null,
      )?.id,
    ).toBe('same');
  });

  it('prefers a per-customer price, then a manual price, then the computed price', () => {
    expect(resolveCustomerPrice({ orgMicros: 5n, manualMicros: 4n, computedMicros: 3n })).toEqual({
      micros: 5n,
      source: 'per-customer',
    });
    expect(resolveCustomerPrice({ orgMicros: null, manualMicros: 4n, computedMicros: 3n })).toEqual(
      {
        micros: 4n,
        source: 'manual',
      },
    );
    expect(
      resolveCustomerPrice({ orgMicros: null, manualMicros: null, computedMicros: 3n }),
    ).toEqual({
      micros: 3n,
      source: 'computed',
    });
    expect(
      resolveCustomerPrice({ orgMicros: null, manualMicros: null, computedMicros: null }),
    ).toBeNull();
  });

  it('uses the latest fixed price that has already started', () => {
    const now = new Date('2026-11-11T00:00:00Z');
    const rows = [
      {
        countryIso2: 'US',
        mccmnc: null,
        priceMicros: 1n,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
      {
        countryIso2: 'US',
        mccmnc: null,
        priceMicros: 2n,
        effectiveFrom: new Date('2026-06-01T00:00:00Z'),
      },
      {
        countryIso2: 'US',
        mccmnc: null,
        priceMicros: 9n,
        effectiveFrom: new Date('2027-01-01T00:00:00Z'),
      },
      {
        countryIso2: 'US',
        mccmnc: '310260',
        priceMicros: 8n,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    expect(currentFixedPrice(rows, 'US', null, now)).toBe(2n);
    expect(currentFixedPrice(rows, 'US', '310260', now)).toBe(8n);
    expect(currentFixedPrice(rows, 'GB', null, now)).toBeNull();
  });
});

describe('money text', () => {
  it('parses and formats USD without floating point', () => {
    expect(parseUsdToMicros('20')).toBe(DEFAULT_DAILY_SPEND_CAP_MICROS);
    expect(parseUsdToMicros('0.015')).toBe(15_000n);
    expect(parseUsdToMicros('0.0001')).toBe(100n);
    expect(parseUsdToMicros('1000000')).toBe(1_000_000_000_000n);
    expect(parseUsdToMicros('1000000.000001')).toBeNull();
    expect(parseUsdToMicros('')).toBeNull();
    expect(parseUsdToMicros('-1')).toBeNull();
    expect(parseUsdToMicros('1.1234567')).toBeNull();
    expect(formatMicros(15_000n, 4)).toBe('0.0150');
    expect(formatMicros(20_000_000n, 2)).toBe('20.00');
    expect(formatMicros(-9_000n, 4)).toBe('-0.0090');
    expect(formatMicros(1_500_000n, 2)).toBe('1.50');
  });

  it('inherits the platform spend cap until an organization overrides it', () => {
    expect(effectiveDailySpendCap(null, 20_000_000n)).toBe(20_000_000n);
    expect(effectiveDailySpendCap(5n, 20_000_000n)).toBe(5n);
  });
});

describe('rate csv', () => {
  it('accepts a country price and a network price', () => {
    const result = parseRateCsv('country,network,price\nUS,,0.0150\n\nUS,310260,0.0200\n');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([
        { line: 2, countryIso2: 'US', mccmnc: null, priceMicros: 15_000n },
        { line: 4, countryIso2: 'US', mccmnc: '310260', priceMicros: 20_000n },
      ]);
    }
  });

  it('rejects a bad header, a duplicate, a zero price, and an empty file', () => {
    expect(parseRateCsv('price\n').ok).toBe(false);
    expect(parseRateCsv('country,network,price\n').ok).toBe(false);
    const duplicate = parseRateCsv('country,network,price\nUS,,0.01\nUS,,0.02\n');
    expect(duplicate.ok).toBe(false);
    const zero = parseRateCsv('country,network,price\nUS,,0\n');
    expect(zero.ok).toBe(false);
    const shape = parseRateCsv('country,network,price\nUSA,,0.01\nUS,12,0.01\nonly-two\n');
    expect(shape.ok).toBe(false);
    if (!shape.ok) {
      expect(shape.errors.length).toBe(3);
    }
  });

  it('stops after 500 data rows', () => {
    const lines = ['country,network,price'];
    for (let index = 0; index < 501; index += 1) {
      lines.push(`US,${String(10000 + index)},0.01`);
    }
    const result = parseRateCsv(lines.join('\n'));
    expect(result.ok).toBe(false);
  });
});

describe('ledger replay', () => {
  it('matches a credit, a hold, a charge, and a release', () => {
    const organizationId = 'org';
    const entries = [
      { organizationId, type: 'ADJUSTMENT' as const, amountMicros: 20_000n, refId: null },
      { organizationId, type: 'HOLD' as const, amountMicros: -5_000n, refId: 'm1' },
      { organizationId, type: 'CHARGE' as const, amountMicros: -5_000n, refId: 'm1' },
      { organizationId, type: 'HOLD' as const, amountMicros: -2_000n, refId: 'm2' },
      { organizationId, type: 'RELEASE' as const, amountMicros: 2_000n, refId: 'm2' },
      { organizationId, type: 'TOPUP' as const, amountMicros: 1n, refId: null },
      { organizationId, type: 'REFUND' as const, amountMicros: 1n, refId: null },
    ];
    expect(
      ledgerDifferences([{ organizationId, availableMicros: 15_002n, heldMicros: 0n }], entries),
    ).toEqual([]);
    expect(
      ledgerDifferences([{ organizationId, availableMicros: 1n, heldMicros: 0n }], entries),
    ).toEqual([
      {
        organizationId,
        availableMicros: 1n,
        heldMicros: 0n,
        ledgerAvailableMicros: 15_002n,
        ledgerHeldMicros: 0n,
      },
    ]);
  });

  it('reports a missing balance row and ignores an organization with no money', () => {
    expect(
      ledgerDifferences(
        [],
        [{ organizationId: 'missing', type: 'HOLD', amountMicros: -5n, refId: 'm' }],
      ),
    ).toEqual([
      {
        organizationId: 'missing',
        availableMicros: 0n,
        heldMicros: 0n,
        ledgerAvailableMicros: -5n,
        ledgerHeldMicros: 5n,
      },
    ]);
    expect(ledgerDifferences([], [])).toEqual([]);
    expect(
      ledgerDifferences(
        [],
        [{ organizationId: 'flat', type: 'ADJUSTMENT', amountMicros: 0n, refId: null }],
      ),
    ).toEqual([]);
    expect(
      ledgerDifferences(
        [],
        [{ organizationId: 'charge', type: 'CHARGE', amountMicros: -4n, refId: 'm' }],
      ),
    ).toEqual([
      {
        organizationId: 'charge',
        availableMicros: 0n,
        heldMicros: 0n,
        ledgerAvailableMicros: 0n,
        ledgerHeldMicros: -4n,
      },
    ]);
  });
});

describe('billing schemas', () => {
  it('accepts an admin list and a provider, and rejects a bad sender request', () => {
    expect(adminListSchema.parse({ pageSize: '25' }).pageSize).toBe(25);
    expect(adminListSchema.safeParse({ pageSize: '3' }).success).toBe(false);
    expect(
      createProviderSchema.parse({
        code: 'mock',
        type: 'MOCK',
        markupPercent: 50,
        maxTps: 100,
      }).code,
    ).toBe('mock');
    expect(
      requestSenderSchema.safeParse({
        type: 'ALPHANUMERIC',
        value: 'A',
        useCase: 'short',
        countries: [],
      }).success,
    ).toBe(false);
  });
});
