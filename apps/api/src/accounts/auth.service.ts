import { Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  PHONE_CODE_TTL_MS,
  RATE_LIMITS,
  TOTP_CHALLENGE_TTL_SECONDS,
  type SessionResponse,
  smsErrorMessage,
} from '@smsvio/shared';
import { normalizePhone } from '@smsvio/shared/phone';
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
  authorizationUrl,
  createPkce,
  exchangeGoogleCode,
  googleConfigured,
  googleDisplayName,
  googleEndpoints,
  googleJwks,
  googleRedirectUri,
  verifyGoogleIdToken,
} from './google.js';
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
import { TeamService } from './team.service.js';

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
    private readonly teams: TeamService,
  ) {}

  async signUp(
    input: { name: string; email: string; password: string; organizationName: string },
    client: ClientInfo,
  ): Promise<{ message: string }> {
    this.assertEmailEnabled();
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
    this.assertEmailEnabled();
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
      await this.redis.set(
        challengeKey(challenge),
        JSON.stringify({ userId: user.id }),
        'EX',
        TOTP_CHALLENGE_TTL_SECONDS,
      );
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
    const stored = await this.redis.getdel(key);
    if (stored === null) {
      throw new ApiError(401, 'invalid_totp', 'That code is incorrect or has expired.');
    }
    const pending = readChallenge(stored);
    await this.limiter.enforce(
      accountKey('totp', pending.userId),
      RATE_LIMITS.totpAccount.limit,
      RATE_LIMITS.totpAccount.windowMs,
    );
    const user = await this.prisma.user.findUnique({ where: { id: pending.userId } });
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
    const organizationId =
      pending.invitationToken === undefined
        ? null
        : await this.teams.claimInvitation(user.id, user.email, pending.invitationToken, client);
    return this.finishSignIn(user.id, client, organizationId);
  }

  async forgotPassword(email: string, client: ClientInfo): Promise<{ message: string }> {
    this.assertEmailEnabled();
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

  async setPassword(state: AuthState, password: string, client: ClientInfo): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: state.userId } });
    if (user === null) {
      throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
    }
    if (user.passwordHash !== null) {
      throw new ApiError(409, 'password_exists', 'Use your current password to change it.');
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: state.userId }, data: { passwordHash } });
      await writeAudit(tx, {
        organizationId: state.organizationId,
        actorUserId: state.userId,
        action: 'account.password_set',
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
    if (this.env.EMAIL_MODE !== 'smtp') {
      throw new ApiError(
        403,
        'phone_unavailable',
        'Phone verification starts when text-message delivery is available.',
      );
    }
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
    const parsed = normalizePhone(phone);
    if (!parsed.ok) {
      throw new ApiError(400, parsed.code, smsErrorMessage(parsed.code));
    }
    const code = await issueToken(this.prisma, {
      userId: user.id,
      purpose: AuthTokenPurpose.PHONE_VERIFICATION,
      ttlMs: PHONE_CODE_TTL_MS,
      subject: parsed.phone.e164,
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

  authConfig(): { emailMode: 'disabled' | 'smtp'; google: boolean } {
    return { emailMode: this.env.EMAIL_MODE, google: googleConfigured(this.env) };
  }

  async beginGoogle(invitation: string | undefined, client: ClientInfo): Promise<string> {
    if (!googleConfigured(this.env)) {
      throw new ApiError(404, 'google_unavailable', 'Google sign-in is not available.');
    }
    await this.limiter.enforce(
      ipKey('google', client.ip),
      RATE_LIMITS.signinIp.limit,
      RATE_LIMITS.signinIp.windowMs,
    );
    const { verifier, challenge } = createPkce();
    const state = randomToken();
    const nonce = randomToken();
    await this.redis.set(
      oauthKey(state),
      JSON.stringify({ verifier, nonce, invitation: invitation ?? null }),
      'EX',
      10 * 60,
    );
    const clientId = this.env.GOOGLE_CLIENT_ID;
    if (clientId === undefined) {
      throw new ApiError(404, 'google_unavailable', 'Google sign-in is not available.');
    }
    return authorizationUrl({
      endpoints: googleEndpoints(this.env),
      clientId,
      redirectUri: googleRedirectUri(this.env.PUBLIC_ORIGIN),
      state,
      nonce,
      challenge,
    });
  }

  async finishGoogle(
    code: string | undefined,
    state: string | undefined,
    client: ClientInfo,
  ): Promise<{ kind: 'session'; opened: OpenedSession } | { kind: 'totp'; challenge: string }> {
    if (code === undefined || state === undefined || code.length === 0 || state.length < 20) {
      throw new ApiError(400, 'invalid_state', 'That sign-in attempt expired. Try again.');
    }
    const stored = await this.redis.getdel(oauthKey(state));
    if (stored === null) {
      throw new ApiError(400, 'invalid_state', 'That sign-in attempt expired. Try again.');
    }
    const pending = readOauth(stored);
    const clientId = this.env.GOOGLE_CLIENT_ID;
    const clientSecret = this.env.GOOGLE_CLIENT_SECRET;
    if (clientId === undefined || clientSecret === undefined) {
      throw new ApiError(404, 'google_unavailable', 'Google sign-in is not available.');
    }
    const endpoints = googleEndpoints(this.env);
    let idToken: string;
    try {
      idToken = await exchangeGoogleCode({
        endpoints,
        clientId,
        clientSecret,
        redirectUri: googleRedirectUri(this.env.PUBLIC_ORIGIN),
        code,
        verifier: pending.verifier,
      });
    } catch {
      throw new ApiError(502, 'google_unavailable', 'Google sign-in is not available right now.');
    }
    let identity;
    try {
      identity = await verifyGoogleIdToken({
        idToken,
        jwks: googleJwks(endpoints.jwksUri),
        issuer: endpoints.issuer,
        audience: clientId,
        nonce: pending.nonce,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'email_unverified') {
        throw new ApiError(
          403,
          'google_email_unverified',
          'That Google account has not verified its email.',
        );
      }
      throw new ApiError(401, 'invalid_state', 'That sign-in attempt expired. Try again.');
    }
    const user = await this.upsertGoogleUser(identity, client);
    if (pending.invitation !== null) {
      const preview = await this.teams.preview(pending.invitation);
      if (preview.email !== user.email) {
        throw new ApiError(
          403,
          'invite_email_mismatch',
          'Use the Google account for the invited email address.',
        );
      }
    }
    if (user.totpEnabledAt !== null && user.totpSecretEnc !== null) {
      const challenge = randomToken();
      await this.redis.set(
        challengeKey(challenge),
        JSON.stringify({
          userId: user.id,
          ...(pending.invitation === null ? {} : { invitationToken: pending.invitation }),
        }),
        'EX',
        TOTP_CHALLENGE_TTL_SECONDS,
      );
      return { kind: 'totp', challenge };
    }
    const organizationId =
      pending.invitation === null
        ? null
        : await this.teams.claimInvitation(user.id, user.email, pending.invitation, client);
    return { kind: 'session', opened: await this.finishSignIn(user.id, client, organizationId) };
  }

  private async upsertGoogleUser(
    identity: { sub: string; email: string; name: string | undefined },
    client: ClientInfo,
  ) {
    const bySub = await this.prisma.user.findUnique({ where: { googleSub: identity.sub } });
    const byEmail = await this.prisma.user.findUnique({ where: { email: identity.email } });
    if (bySub !== null && byEmail !== null && bySub.id !== byEmail.id) {
      throw new ApiError(409, 'google_conflict', 'That Google account cannot be linked.');
    }
    if (bySub !== null) {
      return bySub;
    }
    if (byEmail === null) {
      const created = await this.prisma.user.create({
        data: {
          email: identity.email,
          name: googleDisplayName(identity.name, identity.email),
          passwordHash: null,
          googleSub: identity.sub,
          emailVerifiedAt: new Date(),
          timezone: 'UTC',
        },
      });
      await writeAudit(this.prisma, {
        organizationId: null,
        actorUserId: created.id,
        action: 'account.google_signed_up',
        targetType: 'user',
        targetId: created.id,
        ip: client.ip,
      });
      return created;
    }
    if (byEmail.googleSub !== null && byEmail.googleSub !== identity.sub) {
      throw new ApiError(409, 'google_conflict', 'That Google account cannot be linked.');
    }
    if (byEmail.emailVerifiedAt === null) {
      await this.prisma.session.updateMany({
        where: { userId: byEmail.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleSub: identity.sub,
          emailVerifiedAt: new Date(),
          passwordHash: null,
        },
      });
    }
    if (byEmail.googleSub === null) {
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: { googleSub: identity.sub },
      });
    }
    return byEmail;
  }

  private async finishSignIn(
    userId: string,
    client: ClientInfo,
    organizationId: string | null = null,
  ): Promise<OpenedSession> {
    await this.promotePlatformAdmin(userId);
    const opened = await openSession(this.prisma, userId, client, organizationId);
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
    const hash = user?.passwordHash ?? (await dummyPasswordHash());
    const passwordOk = await verifyPassword(hash, currentPassword);
    if (!user?.passwordHash || !passwordOk) {
      throw new ApiError(401, 'invalid_credentials', 'Current password is incorrect.');
    }
    return user;
  }

  private assertEmailEnabled(): void {
    if (this.env.EMAIL_MODE !== 'smtp') {
      throw new ApiError(403, 'email_disabled', 'Email registration is coming soon.');
    }
  }

  private async promotePlatformAdmin(userId: string): Promise<void> {
    const adminEmail = this.env.SEED_ADMIN_EMAIL;
    if (adminEmail === undefined) {
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      user !== null &&
      user.emailVerifiedAt !== null &&
      user.email.toLowerCase() === adminEmail &&
      !user.isPlatformAdmin
    ) {
      await this.prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
    }
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

function oauthKey(state: string): string {
  return `smsvio:oauth:${hashToken(state)}`;
}

function readChallenge(stored: string): { userId: string; invitationToken?: string } {
  if (stored.startsWith('{')) {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed === 'object' && parsed !== null && 'userId' in parsed) {
      const userId = parsed.userId;
      const invitationToken = 'invitationToken' in parsed ? parsed.invitationToken : undefined;
      if (typeof userId === 'string') {
        return {
          userId,
          ...(typeof invitationToken === 'string' ? { invitationToken } : {}),
        };
      }
    }
  }
  return { userId: stored };
}

function readOauth(stored: string): { verifier: string; nonce: string; invitation: string | null } {
  const parsed: unknown = JSON.parse(stored);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('verifier' in parsed) ||
    !('nonce' in parsed) ||
    typeof parsed.verifier !== 'string' ||
    typeof parsed.nonce !== 'string'
  ) {
    throw new ApiError(400, 'invalid_state', 'That sign-in attempt expired. Try again.');
  }
  const invitation = 'invitation' in parsed ? parsed.invitation : null;
  return {
    verifier: parsed.verifier,
    nonce: parsed.nonce,
    invitation: typeof invitation === 'string' ? invitation : null,
  };
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
