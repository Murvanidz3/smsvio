import { describe, expect, it } from 'vitest';

import { publicRatesSchema } from './public-rates.js';

const country = {
  iso: 'DE',
  name: 'Germany',
  dial_code: '49',
  alpha_sender_allowed: true,
  registration_required: false,
};

describe('public rates schema', () => {
  it('accepts a country list with a matching count', () => {
    const parsed = publicRatesSchema.parse({ count: 1, countries: [country] });
    expect(parsed.countries[0]?.iso).toBe('DE');
  });

  it('rejects a price, a provider field, and a count that does not match', () => {
    expect(
      publicRatesSchema.safeParse({
        count: 1,
        countries: [{ ...country, price: '0.0150' }],
      }).success,
    ).toBe(false);
    expect(publicRatesSchema.safeParse({ count: 2, countries: [country] }).success).toBe(false);
  });
});
