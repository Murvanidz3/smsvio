import { Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  PHONE_CODE_TTL_MS,
  RATE_LIMITS,
  TOTP_CHALLENGE_TTL_SECONDS,
  type SessionResponse,
} from '@smsvio/shared';
import { AuthTokenPurpose, type PrismaClient } from '@smsvio/db';
import { PRISMA, REDIS } from '@smsvio/server';
import { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';

import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { ApiError } from '../http/api-error.js';
import type { ClientInfo } from '../http/client.js';
import { MAILER, type Mailer, emailSubject, renderMessage } from '../mail/mailer.js';
import {
  ExistingAccountEmail,
  PhoneCodeEmail,
  ResetPasswordEmail,
  VerifyEmail,
} from '../mail/templates.js';
import { decryptString, encryptString } from '../security/encryption.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../security/passwords.js';
import { RateLimiter } from '../security/rate-limit.js';
import { hashToken, randomToken } from '../security/tokens.js';
import {
  type AuthState,
  type OpenedSession,
  assertCapability,
  consumeToken,
  deliver,
  invalidCredentials,
  invalidLink,
  issueToken,
  loadAccount,
  openSession,
  presentAccount,
  writeAudit,
} from './support.js';

const CHECK_YOUR_EMAIL = 'Check your email for the next step.';
const RESET_SENT = 'If an account exists for that email, we sent a reset link.';
const VERIFY_SENT = 'If that account still needs verification, we sent another link.';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly limiter: RateLimiter,
  ) {}

  async signUp(
    input: { name: string; email: string; password: string; organizationName: string },
    client: ClientInfo,
  ): Promise<{ message: string }> {
    await this.limiter.enforce(
      ipKey('signup', client.ip),
      RATE_LIMITS.signupIp.limit,
      RATE_LIMITS.signupIp.windowMs,
    );
    await this.limiter.enforce(
      accountKey('signup', input.email),
      RATE_LIMITS.signupEmail.limit,
      RATE_LIMITS.signupEmail.windowMs,
    );

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing !== null) {
      await hashPassword(input.password);
      if (existing.emailVerifiedAt === null) {
        await this.sendVerification(existing.id, existing.email, existing.name);
      } else {
        const rendered = await renderMessage(
          ExistingAccountEmail({ url: `${this.env.PUBLIC_ORIGIN}/signin` }),
        );
        await deliver(this.mailer, {
          to: existing.email,
          subject: emailSubject('Sign in to SMSVIO'),
          ...rendered,
        });
      }
      return { message: CHECK_YOUR_EMAIL };
    }

    const passwordHash = await hashPassword(input.password);
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash, timezone: 'UTC' },
      });
      const organization = await tx.organization.create({
        data: { name: input.organizationName, timezone: 'UTC' },
      });
      await tx.membership.create({
        data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
      });
      const token = await issueToken(tx, {
        userId: user.id,
        purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
        ttlMs: EMAIL_VERIFICATION_TTL_MS,
      });
      await writeAudit(tx, {
        organizationId: organization.id,
        actorUserId: user.id,
        action: 'account.signed_up',
        targetType: 'organization',
        targetId: organization.id,
        ip: client.ip,
      });
      return { user, token };
    });

    const rendered = await renderMessage(
      VerifyEmail({
        name: created.user.name,
        url: actionUrl(this.env.PUBLIC_ORIGIN, '/verify-email', created.token),
      }),
    );
    await deliver(this.mailer, {
      to: created.user.email,
      subject: emailSubject('Confirm your email for SMSVIO'),
      ...rendered,
    });
    return { message: CHECK_YOUR_EMAIL };
  }

  async verifyEmail(token: string, client: ClientInfo): Promise<OpenedSession> {
    const row = await consumeToken(this.prisma, token, AuthTokenPurpose.EMAIL_VERIFICATION);
    if (row === null) {
      throw invalidLink();
    }
    if (row.user.emailVerifiedAt === null) {
      await this.prisma.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: new Date() },
      });
    }
    const opened = await openSession(this.prisma, row.userId, client, null);
    await writeAudit(this.prisma, {
      organizationId: opened.organizationId,
      actorUserId: row.userId,
      action: 'account.email_verified',
      targetType: 'user',
      targetId: row.userId,
      ip: client.ip,
    });
    return opened;
  }

  async resendVerification(email: string, client: ClientInfo): Promise<{ message: string }> {
    await this.limiter.enforce(
      ipKey('verify', client.ip),
      RATE_LIMITS.forgotIp.limit,
      RATE_LIMITS.forgotIp.windowMs,
    );
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user !== null && user.emailVerifiedAt === null) {
      await this.sendVerification(user.id, user.email, user.name);
    }
    return { message: VERIFY_SENT };
  }

  async signIn(
    input: { email: string; password: string },
    client: ClientInfo,
  ): Promise<OpenedSession | { challenge: string }> {
    await this.limiter.enforce(
      ipKey('signin', client.ip),
      RATE_LIMITS.signinIp.limit,
      RATE_LIMITS.signinIp.windowMs,
    );
    await this.limiter.enforce(
      accountKey('signin', input.email),
      RATE_LIMITS.signinAccount.limit,
      RATE_LIMITS.signinAccount.windowMs,
    );

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordHash = user?.passwordHash ?? (await dummyPasswordHash());
    const passwordOk = await verifyPassword(passwordHash, input.password);
    if (user === null || !passwordOk) {
      throw invalidCredentials();
    }
    if (user.emailVerifiedAt === null) {
      await this.sendVerification(user.id, user.email, user.name);
      throw invalidCredentials();
    }
    if (user.totpEnabledAt !== null && user.totpSecretEnc !== null) {
      const challenge = randomToken();
      await this.redis.set(challengeKey(challenge), user.id, 'EX', TOTP_CHALLENGE_TTL_SECONDS);
      return { challenge };
    }
    return this.finishSignIn(user.id, client);
  }

  async completeTotp(challenge: string, code: string, client: ClientInfo): Promise<OpenedSession> {
    await this.limiter.enforce(
      ipKey('totp', client.ip),
      RATE_LIMITS.totpIp.limit,
      RATE_LIMITS.totpIp.windowMs,
    );
    const key = challengeKey(challenge);
    const userId = await this.redis.getdel(key);
    if (userId === null) {
      throw new ApiError(401, 'invalid_totp', 'That code is incorrect or has expired.');
    }
    await this.limiter.enforce(
      accountKey('totp', userId),
      RATE_LIMITS.totpAccount.limit,
      RATE_LIMITS.totpAccount.windowMs,
    );
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecretEnc || user.totpEnabledAt === null) {
      throw new ApiError(401, 'invalid_totp', 'That code is incorrect or has expired.');
    }
    const step = matchTotp(
      user.email,
      user.totpSecretEnc,
      this.env.APP_ENCRYPTION_KEY,
      code,
      user.totpLastStep,
    );
    await this.prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
    return this.finishSignIn(user.id, client);
  }

  async forgotPassword(email: string, client: ClientInfo): Promise<{ message: string }> {
    await this.limiter.enforce(
      ipKey('forgot', client.ip),
      RATE_LIMITS.forgotIp.limit,
      RATE_LIMITS.forgotIp.windowMs,
    );
    await this.limiter.enforce(
      accountKey('forgot', email),
      RATE_LIMITS.forgotEmail.limit,
      RATE_LIMITS.forgotEmail.windowMs,
    );
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user !== null) {
      const token = await issueToken(this.prisma, {
        userId: user.id,
        purpose: AuthTokenPurpose.PASSWORD_RESET,
        ttlMs: PASSWORD_RESET_TTL_MS,
      });
      const rendered = await renderMessage(
        ResetPasswordEmail({ url: actionUrl(this.env.PUBLIC_ORIGIN, '/reset-password', token) }),
      );
      await deliver(this.mailer, {
        to: user.email,
        subject: emailSubject('Reset your SMSVIO password'),
        ...rendered,
      });
    }
    return { message: RESET_SENT };
  }

  async resetPassword(
    token: string,
    password: string,
    client: ClientInfo,
  ): Promise<{ message: string }> {
    const row = await consumeToken(this.prisma, token, AuthTokenPurpose.PASSWORD_RESET);
    if (row === null) {
      throw invalidLink();
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          emailVerifiedAt: row.user.emailVerifiedAt ?? new Date(),
        },
      });
      await tx.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeAudit(tx, {
        organizationId: null,
        actorUserId: row.userId,
        action: 'account.password_reset',
        targetType: 'user',
        targetId: row.userId,
        ip: client.ip,
      });
    });
    return { message: 'Password updated. Sign in with the new password.' };
  }

  async signOut(state: AuthState, client: ClientInfo): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: state.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'account.signed_out',
      targetType: 'session',
      targetId: state.sessionId,
      ip: client.ip,
    });
  }

  async setupTotp(
    state: AuthState,
    currentPassword: string,
  ): Promise<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
  }> {
    const user = await this.requirePassword(state.userId, currentPassword);
    const secret = new Secret({ size: 20 });
    const totp = totpFor(user.email, secret);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpPendingSecretEnc: encryptString(secret.base32, this.env.APP_ENCRYPTION_KEY) },
    });
    const otpauthUrl = totp.toString();
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      margin: 1,
      width: 192,
      errorCorrectionLevel: 'M',
    });
    return { secret: secret.base32, otpauthUrl, qrDataUrl };
  }

  async confirmTotp(state: AuthState, code: string, client: ClientInfo): Promise<SessionResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: state.userId } });
    if (!user?.totpPendingSecretEnc) {
      throw new ApiError(400, 'totp_not_started', 'Start two-factor setup again.');
    }
    const step = matchTotp(
      user.email,
      user.totpPendingSecretEnc,
      this.env.APP_ENCRYPTION_KEY,
      code,
      null,
    );
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecretEnc: user.totpPendingSecretEnc,
        totpPendingSecretEnc: null,
        totpEnabledAt: new Date(),
        totpLastStep: step,
      },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'account.totp_enabled',
      targetType: 'user',
      targetId: state.userId,
      ip: client.ip,
    });
    return this.reload(state);
  }

  async disableTotp(
    state: AuthState,
    currentPassword: string,
    code: string,
    client: ClientInfo,
  ): Promise<SessionResponse> {
    const user = await this.requirePassword(state.userId, currentPassword);
    if (user.totpSecretEnc === null || user.totpEnabledAt === null) {
      throw new ApiError(400, 'totp_disabled', 'Two-factor authentication is not on.');
    }
    matchTotp(user.email, user.totpSecretEnc, this.env.APP_ENCRYPTION_KEY, code, user.totpLastStep);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecretEnc: null,
        totpPendingSecretEnc: null,
        totpEnabledAt: null,
        totpLastStep: null,
      },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'account.totp_disabled',
      targetType: 'user',
      targetId: state.userId,
      ip: client.ip,
    });
    return this.reload(state);
  }

  async updateProfile(state: AuthState, name: string): Promise<SessionResponse> {
    await this.prisma.user.update({ where: { id: state.userId }, data: { name } });
    return this.reload(state);
  }

  async changePassword(
    state: AuthState,
    currentPassword: string,
    password: string,
    client: ClientInfo,
  ): Promise<void> {
    await this.requirePassword(state.userId, currentPassword);
    const passwordHash = await hashPassword(password);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: state.userId }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { userId: state.userId, revokedAt: null, id: { not: state.sessionId } },
        data: { revokedAt: now },
      });
      await writeAudit(tx, {
        organizationId: state.organizationId,
        actorUserId: state.userId,
        action: 'account.password_changed',
        targetType: 'user',
        targetId: state.userId,
        ip: client.ip,
      });
    });
  }

  async updateDetails(
    state: AuthState,
    input: { timezone: string; contactPhone: string | null },
  ): Promise<SessionResponse> {
    await this.prisma.user.update({
      where: { id: state.userId },
      data: { timezone: input.timezone, contactPhone: input.contactPhone },
    });
    return this.reload(state);
  }

  async startPhone(
    state: AuthState,
    phone: string,
    client: ClientInfo,
  ): Promise<{ message: string }> {
    await this.limiter.enforce(
      ipKey('phone', client.ip),
      RATE_LIMITS.phoneIp.limit,
      RATE_LIMITS.phoneIp.windowMs,
    );
    const user = await this.prisma.user.findUnique({ where: { id: state.userId } });
    if (!user?.emailVerifiedAt) {
      throw new ApiError(
        403,
        'email_unverified',
        'Verify your email before confirming a phone number.',
      );
    }
    const code = await issueToken(this.prisma, {
      userId: user.id,
      purpose: AuthTokenPurpose.PHONE_VERIFICATION,
      ttlMs: PHONE_CODE_TTL_MS,
      subject: phone,
    });
    const rendered = await renderMessage(PhoneCodeEmail({ code }));
    await deliver(this.mailer, {
      to: user.email,
      subject: emailSubject('Your SMSVIO confirmation code'),
      ...rendered,
    });
    return { message: 'We emailed you a confirmation code.' };
  }

  async confirmPhone(state: AuthState, code: string, client: ClientInfo): Promise<SessionResponse> {
    const pending = await this.prisma.authToken.findFirst({
      where: {
        userId: state.userId,
        purpose: AuthTokenPurpose.PHONE_VERIFICATION,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending?.subject || pending.attempts >= 5) {
      throw new ApiError(400, 'invalid_code', 'That code is incorrect or has expired.');
    }
    if (pending.tokenHash !== hashToken(code)) {
      const attempts = pending.attempts + 1;
      await this.prisma.authToken.update({
        where: { id: pending.id },
        data: { attempts, usedAt: attempts >= 5 ? new Date() : null },
      });
      throw new ApiError(400, 'invalid_code', 'That code is incorrect or has expired.');
    }
    const consumed = await this.prisma.authToken.updateMany({
      where: { id: pending.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new ApiError(400, 'invalid_code', 'That code is incorrect or has expired.');
    }
    await this.prisma.user.update({
      where: { id: state.userId },
      data: { accountPhoneE164: pending.subject, accountPhoneVerifiedAt: new Date() },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'account.phone_confirmed',
      targetType: 'user',
      targetId: state.userId,
      ip: client.ip,
      meta: { phone: maskStoredPhone(pending.subject) },
    });
    return this.reload(state);
  }

  async updateBusiness(
    state: AuthState,
    input: { legalName: string | null; taxIdType: string | null; taxId: string | null },
    client: ClientInfo,
  ): Promise<SessionResponse> {
    assertCapability(state, 'manage');
    await this.prisma.organization.update({
      where: { id: state.organizationId },
      data: input,
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'organization.updated',
      targetType: 'organization',
      targetId: state.organizationId,
      ip: client.ip,
    });
    return this.reload(state);
  }

  private async finishSignIn(userId: string, client: ClientInfo): Promise<OpenedSession> {
    const opened = await openSession(this.prisma, userId, client, null);
    await writeAudit(this.prisma, {
      organizationId: opened.organizationId,
      actorUserId: userId,
      action: 'account.signed_in',
      targetType: 'session',
      targetId: opened.body.session.id,
      ip: client.ip,
    });
    return opened;
  }

  private async sendVerification(userId: string, email: string, name: string): Promise<void> {
    const token = await issueToken(this.prisma, {
      userId,
      purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
      ttlMs: EMAIL_VERIFICATION_TTL_MS,
    });
    const rendered = await renderMessage(
      VerifyEmail({ name, url: actionUrl(this.env.PUBLIC_ORIGIN, '/verify-email', token) }),
    );
    await deliver(this.mailer, {
      to: email,
      subject: emailSubject('Confirm your email for SMSVIO'),
      ...rendered,
    });
  }

  private async requirePassword(userId: string, currentPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user === null || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new ApiError(401, 'invalid_credentials', 'Current password is incorrect.');
    }
    return user;
  }

  private async reload(state: AuthState): Promise<SessionResponse> {
    const account = await loadAccount(this.prisma, state.userId);
    if (account === null) {
      throw new ApiError(500, 'internal_error', 'Something went wrong.');
    }
    return presentAccount(account, state.sessionId, state.organizationId);
  }
}

function actionUrl(origin: string, path: string, token: string): string {
  const url = new URL(path, origin);
  url.searchParams.set('token', token);
  return url.toString();
}

function challengeKey(challenge: string): string {
  return `smsvio:totp:${hashToken(challenge)}`;
}

function ipKey(action: string, ip: string | null): string {
  return `ip:${action}:${ip ?? 'unknown'}`;
}

function accountKey(action: string, value: string): string {
  return `acct:${action}:${hashToken(value)}`;
}

function totpFor(email: string, secret: Secret): TOTP {
  return new TOTP({
    issuer: 'SMSVIO',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
}

function matchTotp(
  email: string,
  secretEnc: string,
  key: string,
  code: string,
  lastStep: number | null,
): number {
  let base32: string;
  try {
    base32 = decryptString(secretEnc, key);
  } catch {
    throw new ApiError(500, 'internal_error', 'Something went wrong.');
  }
  const timestamp = Date.now();
  const delta = totpFor(email, Secret.fromBase32(base32)).validate({
    token: code,
    timestamp,
    window: 1,
    afterCounter: lastStep,
  });
  if (delta === null) {
    throw new ApiError(401, 'invalid_totp', 'That code is incorrect or has expired.');
  }
  return TOTP.counter({ period: 30, timestamp }) + delta;
}

function maskStoredPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) {
    return '••••';
  }
  return `${phone.startsWith('+') ? '+' : ''}${digits.slice(0, 3)}••••${digits.slice(-2)}`;
}
