import { Inject, Injectable } from '@nestjs/common';
import {
  INVITATION_TTL_MS,
  type DirectoryResponse,
  type InvitePreview,
  type InviteRole,
  type MembershipRole,
  type SessionResponse,
  memberListQuerySchema,
} from '@smsvio/shared';
import type { PrismaClient } from '@smsvio/db';
import { PRISMA } from '@smsvio/server';

import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { ApiError, validationError } from '../http/api-error.js';
import type { ClientInfo } from '../http/client.js';
import { MAILER, type Mailer, emailSubject, renderMessage } from '../mail/mailer.js';
import { InvitationEmail } from '../mail/templates.js';
import { hashPassword } from '../security/passwords.js';
import { hashToken, randomToken } from '../security/tokens.js';
import {
  type AuthState,
  type OpenedSession,
  assertCapability,
  deliver,
  invalidLink,
  isUniqueConflict,
  loadAccount,
  openSession,
  presentAccount,
  writeAudit,
} from './support.js';

type ListQuery = ReturnType<typeof memberListQuerySchema.parse>;

export type AcceptResult =
  | { kind: 'session'; opened: OpenedSession }
  | { kind: 'switch'; organizationId: string; body: SessionResponse }
  | { kind: 'sign_in_required'; email: string };

@Injectable()
export class TeamService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async list(state: AuthState, query: ListQuery): Promise<DirectoryResponse> {
    assertCapability(state, 'view');
    const organizationId = state.organizationId;
    const members =
      query.status === 'INVITED'
        ? []
        : await this.prisma.membership.findMany({
            where: {
              organizationId,
              ...(query.role === undefined ? {} : { role: query.role }),
              ...(query.q === ''
                ? {}
                : {
                    user: {
                      OR: [
                        { email: { contains: query.q, mode: 'insensitive' } },
                        { name: { contains: query.q, mode: 'insensitive' } },
                      ],
                    },
                  }),
            },
            include: { user: true },
          });
    const invitations =
      query.status === 'ACTIVE'
        ? []
        : await this.prisma.invitation.findMany({
            where: {
              organizationId,
              acceptedAt: null,
              revokedAt: null,
              expiresAt: { gt: new Date() },
              ...(query.role === undefined ? {} : { role: query.role }),
              ...(query.q === '' ? {} : { email: { contains: query.q, mode: 'insensitive' } }),
            },
          });

    const rows = [
      ...members.map((membership) => ({
        kind: 'member' as const,
        id: membership.id,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role,
        status: 'ACTIVE' as const,
        lastSeenAt: membership.user.lastSeenAt?.toISOString() ?? null,
        sortName: membership.user.name,
      })),
      ...invitations.map((invitation) => ({
        kind: 'invitation' as const,
        id: invitation.id,
        name: null,
        email: invitation.email,
        role: invitation.role,
        status: 'INVITED' as const,
        lastSeenAt: null,
        sortName: invitation.email,
      })),
    ];
    rows.sort((left, right) => compareRows(left, right, query.sort, query.direction));
    const start = (query.page - 1) * query.pageSize;
    return {
      items: rows
        .slice(start, start + query.pageSize)
        .map(({ sortName: _sortName, ...row }) => row),
      total: rows.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async invite(
    state: AuthState,
    input: { email: string; role: InviteRole },
    client: ClientInfo,
  ): Promise<{ id: string; message: string }> {
    assertCapability(state, 'manage');
    const member = await this.prisma.membership.findFirst({
      where: { organizationId: state.organizationId, user: { email: input.email } },
    });
    if (member !== null) {
      throw new ApiError(409, 'already_member', 'That person is already a member.');
    }
    const organization = await this.prisma.organization.findUnique({
      where: { id: state.organizationId },
    });
    if (organization === null) {
      throw new ApiError(404, 'not_found', 'That organization does not exist.');
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const pending = await this.prisma.invitation.findFirst({
      where: {
        organizationId: state.organizationId,
        email: input.email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    const invitation = pending
      ? await this.prisma.invitation.update({
          where: { id: pending.id },
          data: {
            role: input.role,
            tokenHash: hashToken(token),
            expiresAt,
            invitedById: state.userId,
          },
        })
      : await this.prisma.invitation.create({
          data: {
            organizationId: state.organizationId,
            email: input.email,
            role: input.role,
            tokenHash: hashToken(token),
            expiresAt,
            invitedById: state.userId,
          },
        });
    await this.sendInvite(input.email, organization.name, token);
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: pending === null ? 'invitation.created' : 'invitation.resent',
      targetType: 'invitation',
      targetId: invitation.id,
      meta: { role: input.role },
      ip: client.ip,
    });
    return { id: invitation.id, message: 'Invitation sent.' };
  }

  async resend(
    state: AuthState,
    invitationId: string,
    client: ClientInfo,
  ): Promise<{ message: string }> {
    assertCapability(state, 'manage');
    const invitation = await this.openInvitation(state.organizationId, invitationId);
    const token = randomToken();
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
    });
    await this.sendInvite(invitation.email, invitation.organization.name, token);
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'invitation.resent',
      targetType: 'invitation',
      targetId: invitation.id,
      ip: client.ip,
    });
    return { message: 'Invitation sent.' };
  }

  async revoke(
    state: AuthState,
    invitationId: string,
    client: ClientInfo,
  ): Promise<{ message: string }> {
    assertCapability(state, 'manage');
    const invitation = await this.openInvitation(state.organizationId, invitationId);
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'invitation.revoked',
      targetType: 'invitation',
      targetId: invitation.id,
      ip: client.ip,
    });
    return { message: 'Invitation revoked.' };
  }

  async changeRole(
    state: AuthState,
    membershipId: string,
    role: InviteRole,
    client: ClientInfo,
  ): Promise<{ message: string }> {
    assertCapability(state, 'manage');
    const membership = await this.membershipInOrg(state.organizationId, membershipId);
    if (membership.role === 'OWNER') {
      throw new ApiError(
        409,
        'owner_role',
        'Transfer ownership instead of changing the owner role.',
      );
    }
    if (membership.userId === state.userId) {
      throw new ApiError(409, 'own_role', 'You cannot change your own role.');
    }
    await this.prisma.membership.update({ where: { id: membership.id }, data: { role } });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'membership.role_changed',
      targetType: 'membership',
      targetId: membership.id,
      meta: { role },
      ip: client.ip,
    });
    return { message: 'Role updated.' };
  }

  async remove(
    state: AuthState,
    membershipId: string,
    client: ClientInfo,
  ): Promise<{ message: string }> {
    assertCapability(state, 'manage');
    const membership = await this.membershipInOrg(state.organizationId, membershipId);
    if (membership.role === 'OWNER') {
      throw new ApiError(409, 'owner_role', 'Transfer ownership before removing the owner.');
    }
    if (membership.userId === state.userId) {
      throw new ApiError(409, 'own_membership', 'You cannot remove yourself.');
    }
    await this.prisma.membership.delete({ where: { id: membership.id } });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'membership.removed',
      targetType: 'membership',
      targetId: membership.id,
      ip: client.ip,
    });
    return { message: 'Member removed.' };
  }

  async transfer(
    state: AuthState,
    membershipId: string,
    client: ClientInfo,
  ): Promise<SessionResponse> {
    assertCapability(state, 'own');
    const target = await this.membershipInOrg(state.organizationId, membershipId);
    if (target.userId === state.userId) {
      throw new ApiError(409, 'own_role', 'You are already the owner.');
    }
    const mine = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: state.userId, organizationId: state.organizationId },
      },
    });
    if (mine === null) {
      throw new ApiError(403, 'forbidden', 'You do not have access to that.');
    }
    if (mine.role !== 'OWNER') {
      throw new ApiError(403, 'forbidden', 'You do not have access to that.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: mine.id }, data: { role: 'ADMIN' } });
      await tx.membership.update({ where: { id: target.id }, data: { role: 'OWNER' } });
      await writeAudit(tx, {
        organizationId: state.organizationId,
        actorUserId: state.userId,
        action: 'organization.ownership_transferred',
        targetType: 'membership',
        targetId: target.id,
        ip: client.ip,
      });
    });
    return this.present(state.userId, state.sessionId, state.organizationId);
  }

  async switchOrganization(state: AuthState, organizationId: string): Promise<SessionResponse> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: state.userId, organizationId } },
    });
    if (membership === null) {
      throw new ApiError(404, 'not_found', 'That organization does not exist.');
    }
    return this.present(state.userId, state.sessionId, organizationId);
  }

  async deleteOrganization(
    state: AuthState,
    confirmName: string,
    client: ClientInfo,
  ): Promise<SessionResponse> {
    assertCapability(state, 'own');
    const organization = await this.prisma.organization.findUnique({
      where: { id: state.organizationId },
    });
    if (organization === null) {
      throw new ApiError(404, 'not_found', 'That organization does not exist.');
    }
    if (organization.name !== confirmName) {
      throw validationError({ confirmName: 'Type the organization name to confirm.' });
    }
    await writeAudit(this.prisma, {
      organizationId: null,
      actorUserId: state.userId,
      action: 'organization.deleted',
      targetType: 'organization',
      targetId: organization.id,
      meta: { name: organization.name },
      ip: client.ip,
    });
    await this.prisma.organization.delete({ where: { id: organization.id } });
    return this.present(state.userId, state.sessionId, null);
  }

  async preview(token: string): Promise<InvitePreview> {
    const invitation = await this.findByToken(token);
    if (invitation === null || !isInviteRole(invitation.role)) {
      throw invalidLink();
    }
    const account = await this.prisma.user.findUnique({ where: { email: invitation.email } });
    return {
      email: invitation.email,
      organizationName: invitation.organization.name,
      role: invitation.role,
      hasAccount: account !== null,
    };
  }

  async accept(
    input: { token: string; name?: string; password?: string },
    state: AuthState | null,
    client: ClientInfo,
  ): Promise<AcceptResult> {
    const invitation = await this.findByToken(input.token);
    if (invitation === null || !isInviteRole(invitation.role)) {
      throw invalidLink();
    }
    const existing = await this.prisma.user.findUnique({ where: { email: invitation.email } });
    if (state !== null && state.body.user.email !== invitation.email) {
      throw new ApiError(
        403,
        'invite_email_mismatch',
        'Sign in with the invited email address to accept.',
      );
    }
    if (state === null && existing !== null) {
      return { kind: 'sign_in_required', email: invitation.email };
    }

    let userId = state?.userId ?? existing?.id;
    if (userId === undefined) {
      if (input.name === undefined || input.password === undefined) {
        throw validationError({
          ...(input.name === undefined ? { name: 'Enter your name.' } : {}),
          ...(input.password === undefined ? { password: 'Choose a password.' } : {}),
        });
      }
      const passwordHash = await hashPassword(input.password);
      const created = await this.prisma.user.create({
        data: {
          email: invitation.email,
          name: input.name,
          passwordHash,
          emailVerifiedAt: new Date(),
          timezone: 'UTC',
        },
      });
      userId = created.id;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.membership.create({
          data: {
            userId: userId,
            organizationId: invitation.organizationId,
            role: invitation.role,
          },
        });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });
        await writeAudit(tx, {
          organizationId: invitation.organizationId,
          actorUserId: userId,
          action: 'invitation.accepted',
          targetType: 'invitation',
          targetId: invitation.id,
          ip: client.ip,
        });
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ApiError(409, 'already_member', 'You are already a member of that organization.');
      }
      throw error;
    }

    if (state === null) {
      return {
        kind: 'session',
        opened: await openSession(this.prisma, userId, client, invitation.organizationId),
      };
    }
    return {
      kind: 'switch',
      organizationId: invitation.organizationId,
      body: await this.present(userId, state.sessionId, invitation.organizationId),
    };
  }

  async listAudit(state: AuthState, page: number, pageSize: number) {
    assertCapability(state, 'view');
    const where = { organizationId: state.organizationId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        actorUserId: row.actorUserId,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  private async sendInvite(email: string, organizationName: string, token: string): Promise<void> {
    const url = new URL('/accept-invite', this.env.PUBLIC_ORIGIN);
    url.searchParams.set('token', token);
    const rendered = await renderMessage(
      InvitationEmail({ organizationName, url: url.toString() }),
    );
    await deliver(this.mailer, {
      to: email,
      subject: emailSubject(`Join ${organizationName} on SMSVIO`),
      ...rendered,
    });
  }

  private async openInvitation(organizationId: string, invitationId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: {
        id: invitationId,
        organizationId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { organization: true },
    });
    if (invitation === null) {
      throw new ApiError(404, 'not_found', 'That invitation does not exist.');
    }
    return invitation;
  }

  private async membershipInOrg(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
    });
    if (membership === null) {
      throw new ApiError(404, 'not_found', 'That member does not exist.');
    }
    return membership;
  }

  private async findByToken(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: true },
    });
    if (invitation === null) {
      return null;
    }
    if (
      invitation.acceptedAt !== null ||
      invitation.revokedAt !== null ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }
    return invitation;
  }

  private async present(
    userId: string,
    sessionId: string,
    organizationId: string | null,
  ): Promise<SessionResponse> {
    const account = await loadAccount(this.prisma, userId);
    if (account === null) {
      throw new ApiError(500, 'internal_error', 'Something went wrong.');
    }
    return presentAccount(account, sessionId, organizationId);
  }
}

function isInviteRole(role: MembershipRole): role is InviteRole {
  return role !== 'OWNER';
}

interface SortableRow {
  readonly name: string | null;
  readonly email: string;
  readonly role: MembershipRole;
  readonly lastSeenAt: string | null;
  readonly sortName: string;
}

function compareRows(
  left: SortableRow,
  right: SortableRow,
  sort: ListQuery['sort'],
  direction: ListQuery['direction'],
): number {
  const sign = direction === 'asc' ? 1 : -1;
  const leftValue =
    sort === 'email'
      ? left.email
      : sort === 'role'
        ? left.role
        : sort === 'lastSeenAt'
          ? left.lastSeenAt
          : left.sortName;
  const rightValue =
    sort === 'email'
      ? right.email
      : sort === 'role'
        ? right.role
        : sort === 'lastSeenAt'
          ? right.lastSeenAt
          : right.sortName;
  if (leftValue === rightValue) {
    return left.email.localeCompare(right.email);
  }
  if (leftValue === null) {
    return 1;
  }
  if (rightValue === null) {
    return -1;
  }
  return leftValue.localeCompare(rightValue) * sign;
}
