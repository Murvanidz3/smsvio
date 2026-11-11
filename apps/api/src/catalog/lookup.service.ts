import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { RATE_LIMITS } from '@smsvio/shared';
import { lookupPhone } from '@smsvio/shared/phone';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertCapability } from '../accounts/support.js';
import { RateLimiter } from '../security/rate-limit.js';

@Injectable()
export class LookupService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly limits: RateLimiter,
  ) {}

  async countries(state: AuthState) {
    assertCapability(state, 'view');
    const rows = await this.prisma.country.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
    });
    return {
      items: rows.map((country) => ({
        iso2: country.iso2,
        name: country.name,
        dialCode: country.dialCode,
        alphaSenderAllowed: country.alphaSenderAllowed,
        registrationRequired: country.registrationRequired,
      })),
    };
  }

  async lookup(state: AuthState, input: { phone: string; country?: string }) {
    assertCapability(state, 'view');
    await this.limits.enforce(
      `lookup:${state.userId}`,
      RATE_LIMITS.lookupUser.limit,
      RATE_LIMITS.lookupUser.windowMs,
    );
    return lookupPhone(input.phone, input.country);
  }
}
