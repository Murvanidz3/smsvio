import { RATE_LIMITS } from '@smsvio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublicRatesService } from './rates.service.js';

const germany = {
  iso2: 'DE',
  name: 'Germany',
  dialCode: '49',
  alphaSenderAllowed: false,
  registrationRequired: true,
  notes: 'upstream-provider-cost-margin',
  enabled: true,
};

describe('public rates service', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns enabled countries and hides cost, provider and price fields', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
    const findMany = vi.fn(() => Promise.resolve([germany]));
    const enforce = vi.fn(() => Promise.resolve());
    const service = new PublicRatesService(
      { country: { findMany } } as never,
      { enforce } as never,
    );

    const first = await service.list(null);
    const second = await service.list('203.0.113.8');

    expect(enforce).toHaveBeenNthCalledWith(
      1,
      'ip:public-rates:unknown',
      RATE_LIMITS.publicRates.limit,
      RATE_LIMITS.publicRates.windowMs,
    );
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      select: {
        iso2: true,
        name: true,
        dialCode: true,
        alphaSenderAllowed: true,
        registrationRequired: true,
      },
    });
    expect(second).toBe(first);
    expect(first).toEqual({
      count: 1,
      countries: [
        {
          iso: 'DE',
          name: 'Germany',
          dial_code: '49',
          alpha_sender_allowed: false,
          registration_required: true,
        },
      ],
    });
    expect(JSON.stringify(first)).not.toContain('upstream-provider');

    vi.setSystemTime(new Date('2026-11-17T12:11:00Z'));
    await service.list('203.0.113.8');
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
