import { createHash } from 'node:crypto';

import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { API_KEY_RATE_LIMIT, API_KEY_RATE_WINDOW_MS, type MembershipRole } from '@smsvio/shared';
import { apiKeyMode } from '@smsvio/shared/developer';
import { PRISMA } from '@smsvio/server';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AuthState } from '../accounts/support.js';
import { ApiError } from '../http/api-error.js';
import { RateLimiter } from '../security/rate-limit.js';
import { hashToken, tokensEqual } from '../security/tokens.js';

const DUMMY_HASH = hashToken('svk_live_missing');
const USED_INTERVAL_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly limits: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const path = request.url.split('?')[0] ?? request.url;
    if (path === '/api/v1/openapi.json') {
      return true;
    }
    const token = readPresentedKey(request);
    if (token === null || apiKeyMode(token) === null) {
      throw new ApiError(401, 'unauthenticated', 'That API key is not valid.');
    }
    const hash = hashToken(token);
    const row = await this.prisma.apiKey.findUnique({ where: { keyHash: hash } });
    const match = tokensEqual(hash, row?.keyHash ?? DUMMY_HASH);
    if (!match || row?.status !== 'ACTIVE') {
      throw new ApiError(401, 'unauthenticated', 'That API key is not valid.');
    }
    const decision = await this.limits.hit(
      `apikey:${row.id}`,
      API_KEY_RATE_LIMIT,
      API_KEY_RATE_WINDOW_MS,
    );
    void reply.header('ratelimit-limit', String(decision.limit));
    void reply.header('ratelimit-remaining', String(decision.remaining));
    void reply.header('ratelimit-reset', String(decision.allowed ? 1 : decision.retryAfterSeconds));
    if (!decision.allowed) {
      throw new ApiError(
        429,
        'rate_limited',
        'Too many requests. Try again later.',
        undefined,
        decision.retryAfterSeconds,
      );
    }
    if (row.lastUsedAt === null || Date.now() - row.lastUsedAt.getTime() > USED_INTERVAL_MS) {
      await this.prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    }
    request.apiKey = { id: row.id, mode: row.mode, organizationId: row.organizationId };
    request.auth = await this.actor(row.organizationId, row.createdById);
    return true;
  }

  private async actor(organizationId: string, userId: string): Promise<AuthState> {
    const [user, organization] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
    ]);
    if (user === null || organization === null) {
      throw new ApiError(401, 'unauthenticated', 'That API key is not valid.');
    }
    const role: MembershipRole = 'DEVELOPER';
    return {
      userId: user.id,
      sessionId: user.id,
      organizationId: organization.id,
      role,
      body: {
        status: 'authenticated',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          timezone: user.timezone,
          totpEnabled: user.totpEnabledAt !== null,
          isPlatformAdmin: user.isPlatformAdmin,
          accountPhoneE164: user.accountPhoneE164,
          accountPhoneVerifiedAt: user.accountPhoneVerifiedAt?.toISOString() ?? null,
          contactPhone: user.contactPhone,
          hasPassword: user.passwordHash !== null,
        },
        session: { id: user.id },
        organization: {
          id: organization.id,
          name: organization.name,
          legalName: organization.legalName,
          status: organization.status,
          role,
          timezone: organization.timezone,
          smartEncoding: organization.smartEncoding,
          taxIdType: organization.taxIdType,
          taxId: organization.taxId,
        },
        memberships: [{ organizationId: organization.id, name: organization.name, role }],
      },
    };
  }
}

export function readPresentedKey(request: FastifyRequest): string | null {
  const header = request.headers['x-api-key'];
  const direct = Array.isArray(header) ? header[0] : header;
  if (typeof direct === 'string' && direct.trim() !== '' && direct.length <= 200) {
    return direct.trim();
  }
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  const bearer = match?.[1];
  if (bearer === undefined || bearer.length > 200) {
    return null;
  }
  return bearer;
}

export function batchIdempotencyKey(organizationId: string, header: string): string {
  return `smsvio:idem:batch:${organizationId}:${createHash('sha256').update(header).digest('hex')}`;
}
