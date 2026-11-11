import {
  type Capability,
  type MembershipRole,
  type SessionResponse,
  SESSION_EXTEND_BELOW_MS,
  SESSION_TTL_MS,
  roleAllows,
} from '@smsvio/shared';
import { AuthTokenPurpose, Prisma, type PrismaClient } from '@smsvio/db';

import { ApiError } from '../http/api-error.js';
import type { ClientInfo } from '../http/client.js';
import type { Mailer, OutboundEmail } from '../mail/mailer.js';
import { hashToken, randomCode, randomToken } from '../security/tokens.js';

export type Db = PrismaClient | Prisma.TransactionClient;

export interface AuthState {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId: string | null;
  readonly role: MembershipRole | null;
  readonly body: SessionResponse;
}

export interface OpenedSession {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly organizationId: string | null;
  readonly body: SessionResponse;
}

const accountInclude = {
  memberships: {
    where: { status: 'ACTIVE' as const },
    include: { organization: true },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.UserInclude;

export async function loadAccount(db: Db, userId: string) {
  return db.user.findUnique({ where: { id: userId }, include: accountInclude });
}

type AccountRecord = NonNullable<Awaited<ReturnType<typeof loadAccount>>>;

export function presentAccount(
  account: AccountRecord,
  sessionId: string,
  requestedOrganizationId: string | null,
): SessionResponse {
  const memberships = account.memberships.map((membership) => ({
    organizationId: membership.organizationId,
    name: membership.organization.name,
    role: membership.role,
  }));
  const active =
    account.memberships.find(
      (membership) => membership.organizationId === requestedOrganizationId,
    ) ??
    account.memberships[0] ??
    null;
  return {
    status: 'authenticated',
    user: {
      id: account.id,
      email: account.email,
      name: account.name,
      timezone: account.timezone,
      totpEnabled: account.totpEnabledAt !== null,
      isPlatformAdmin: account.isPlatformAdmin,
      accountPhoneE164: account.accountPhoneE164,
      accountPhoneVerifiedAt: account.accountPhoneVerifiedAt?.toISOString() ?? null,
      contactPhone: account.contactPhone,
    },
    session: { id: sessionId },
    organization:
      active === null
        ? null
        : {
            id: active.organization.id,
            name: active.organization.name,
            legalName: active.organization.legalName,
            status: active.organization.status,
            role: active.role,
            timezone: active.organization.timezone,
            taxIdType: active.organization.taxIdType,
            taxId: active.organization.taxId,
          },
    memberships,
  };
}

export function assertCapability(
  state: AuthState,
  capability: Capability,
): asserts state is AuthState & { organizationId: string; role: MembershipRole } {
  if (state.organizationId === null || state.role === null) {
    throw new ApiError(409, 'organization_required', 'Join an organization to do that.');
  }
  if (!roleAllows(state.role, capability)) {
    throw new ApiError(403, 'forbidden', 'You do not have access to that.');
  }
}

export async function writeAudit(
  db: Db,
  entry: {
    organizationId: string | null;
    actorUserId: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    meta?: Prisma.InputJsonValue;
    ip: string | null;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      meta: entry.meta,
      ip: entry.ip,
    },
  });
}

export async function issueToken(
  db: Db,
  input: { userId: string; purpose: AuthTokenPurpose; ttlMs: number; subject?: string },
): Promise<string> {
  const token =
    input.purpose === AuthTokenPurpose.PHONE_VERIFICATION ? randomCode() : randomToken();
  const now = new Date();
  await db.authToken.updateMany({
    where: { userId: input.userId, purpose: input.purpose, usedAt: null },
    data: { usedAt: now },
  });
  await db.authToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashToken(token),
      subject: input.subject ?? null,
      expiresAt: new Date(now.getTime() + input.ttlMs),
    },
  });
  return token;
}

export async function consumeToken(db: Db, raw: string, purpose: AuthTokenPurpose) {
  const row = await db.authToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (row === null) {
    return null;
  }
  if (row.purpose !== purpose || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  const consumed = await db.authToken.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) {
    return null;
  }
  return row;
}

export async function openSession(
  db: Db,
  userId: string,
  client: ClientInfo,
  requestedOrganizationId: string | null,
): Promise<OpenedSession> {
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(sessionToken),
      ip: client.ip,
      userAgent: client.userAgent,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const account = await loadAccount(db, userId);
  if (account === null) {
    throw new ApiError(500, 'internal_error', 'Something went wrong.');
  }
  const body = presentAccount(account, session.id, requestedOrganizationId);
  return { sessionToken, csrfToken, organizationId: body.organization?.id ?? null, body };
}

export async function deliver(mailer: Mailer, message: OutboundEmail): Promise<void> {
  try {
    await mailer.send(message);
  } catch {
    throw new ApiError(503, 'email_failed', 'We could not send the email. Try again in a moment.');
  }
}

export function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function sessionNeedsExtension(expiresAt: Date, now = Date.now()): boolean {
  return expiresAt.getTime() - now < SESSION_EXTEND_BELOW_MS;
}

export const LAST_SEEN_GAP_MS = 5 * 60 * 1000;

export function invalidCredentials(): ApiError {
  return new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');
}

export function invalidLink(): ApiError {
  return new ApiError(400, 'invalid_link', 'This link is invalid or has expired.');
}
