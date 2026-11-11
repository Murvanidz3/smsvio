import { Inject, Injectable } from '@nestjs/common';
import {
  ORGANIZATION_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type SessionListResponse,
} from '@smsvio/shared';
import type { PrismaClient } from '@smsvio/db';
import { PRISMA } from '@smsvio/server';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../http/api-error.js';
import { hashToken } from '../security/tokens.js';
import {
  type AuthState,
  LAST_SEEN_GAP_MS,
  loadAccount,
  presentAccount,
  sessionNeedsExtension,
  writeAudit,
} from './support.js';

export interface ResolvedSession {
  readonly state: AuthState;
  readonly extendCookie: boolean;
}

@Injectable()
export class SessionService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async resolve(request: FastifyRequest): Promise<ResolvedSession | null> {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw === undefined) {
      return null;
    }
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (session === null) {
      return null;
    }
    if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    const account = await loadAccount(this.prisma, session.userId);
    if (account === null) {
      return null;
    }

    const now = new Date();
    const extendCookie = sessionNeedsExtension(session.expiresAt, now.getTime());
    if (extendCookie) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
      });
    }
    const lastSeen = account.lastSeenAt?.getTime() ?? 0;
    if (now.getTime() - lastSeen > LAST_SEEN_GAP_MS) {
      await this.prisma.user.update({ where: { id: account.id }, data: { lastSeenAt: now } });
    }

    const requested = request.cookies[ORGANIZATION_COOKIE] ?? null;
    const body = presentAccount(account, session.id, requested);
    return {
      extendCookie,
      state: {
        userId: account.id,
        sessionId: session.id,
        organizationId: body.organization?.id ?? null,
        role: body.organization?.role ?? null,
        body,
      },
    };
  }

  async list(state: AuthState): Promise<SessionListResponse> {
    const rows = await this.prisma.session.findMany({
      where: { userId: state.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        current: row.id === state.sessionId,
      })),
    };
  }

  async revoke(
    state: AuthState,
    sessionId: string,
    ip: string | null,
  ): Promise<{ current: boolean }> {
    const revoked = await this.prisma.session.updateMany({
      where: { id: sessionId, userId: state.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      throw new ApiError(404, 'not_found', 'That session does not exist.');
    }
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'session.revoked',
      targetType: 'session',
      targetId: sessionId,
      ip,
    });
    return { current: sessionId === state.sessionId };
  }
}
