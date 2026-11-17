import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { RATE_LIMITS, type PublicRates } from '@smsvio/shared';
import { PRISMA } from '@smsvio/server';

import { RateLimiter } from '../security/rate-limit.js';

const CACHE_MS = 10 * 60 * 1000;

@Injectable()
export class PublicRatesService {
  private cached: { at: number; body: PublicRates } | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly limits: RateLimiter,
  ) {}

  async list(ip: string | null): Promise<PublicRates> {
    await this.limits.enforce(
      `ip:public-rates:${ip ?? 'unknown'}`,
      RATE_LIMITS.publicRates.limit,
      RATE_LIMITS.publicRates.windowMs,
    );
    const now = Date.now();
    if (this.cached !== null && now - this.cached.at < CACHE_MS) {
      return this.cached.body;
    }
    const rows = await this.prisma.country.findMany({
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
    const body: PublicRates = {
      count: rows.length,
      countries: rows.map((row) => ({
        iso: row.iso2,
        name: row.name,
        dial_code: row.dialCode,
        alpha_sender_allowed: row.alphaSenderAllowed,
        registration_required: row.registrationRequired,
      })),
    };
    this.cached = { at: now, body };
    return body;
  }
}
