import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { SessionResponse } from '@smsvio/shared';
import {
  acceptInviteSchema,
  auditListQuerySchema,
  businessSettingsSchema,
  changePasswordSchema,
  changeRoleSchema,
  deleteOrganizationSchema,
  detailsSchema,
  disableTotpSchema,
  emailOnlySchema,
  inviteSchema,
  memberListQuerySchema,
  phoneConfirmSchema,
  phoneStartSchema,
  profileSchema,
  resetPasswordSchema,
  signInSchema,
  signupSchema,
  switchOrganizationSchema,
  tokenSchema,
  totpChallengeSchema,
  totpCodeSchema,
  idParamSchema,
} from '@smsvio/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { ApiError } from '../http/api-error.js';
import { clientInfo } from '../http/client.js';
import { firstQueryValues, parseInput } from '../http/parse.js';
import {
  applyOrganizationCookie,
  applySessionCookies,
  clearAuthCookies,
  cookieSecure,
} from '../security/cookies.js';
import { AuthService } from './auth.service.js';
import { OptionalSessionGuard, SessionGuard } from './guards.js';
import { SessionService } from './session.service.js';
import type { AuthState, OpenedSession } from './support.js';
import { TeamService } from './team.service.js';

function current(request: FastifyRequest): AuthState {
  if (request.auth === undefined) {
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  }
  return request.auth;
}

@Controller('internal/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly teams: TeamService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Post('signup')
  @HttpCode(200)
  signUp(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.auth.signUp(parseInput(signupSchema, body), clientInfo(request));
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const opened = await this.auth.verifyEmail(
      parseInput(tokenSchema, body).token,
      clientInfo(request),
    );
    return this.establish(reply, opened);
  }

  @Post('verification/resend')
  @HttpCode(200)
  resend(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.auth.resendVerification(
      parseInput(emailOnlySchema, body).email,
      clientInfo(request),
    );
  }

  @Post('signin')
  @HttpCode(200)
  async signIn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const result = await this.auth.signIn(parseInput(signInSchema, body), clientInfo(request));
    if ('challenge' in result) {
      return { status: 'totp_required' as const, challenge: result.challenge };
    }
    return this.establish(reply, result);
  }

  @Post('totp')
  @HttpCode(200)
  async totp(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parseInput(totpChallengeSchema, body);
    const opened = await this.auth.completeTotp(input.challenge, input.code, clientInfo(request));
    return this.establish(reply, opened);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgot(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.auth.forgotPassword(parseInput(emailOnlySchema, body).email, clientInfo(request));
  }

  @Post('reset-password')
  @HttpCode(200)
  reset(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parseInput(resetPasswordSchema, body);
    return this.auth.resetPassword(input.token, input.password, clientInfo(request));
  }

  @Post('invitations/preview')
  @HttpCode(200)
  preview(@Body() body: unknown) {
    return this.teams.preview(parseInput(tokenSchema, body).token);
  }

  @Post('invitations/accept')
  @HttpCode(200)
  @UseGuards(OptionalSessionGuard)
  async accept(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const result = await this.teams.accept(
      parseInput(acceptInviteSchema, body),
      request.auth ?? null,
      clientInfo(request),
    );
    if (result.kind === 'sign_in_required') {
      return { status: 'sign_in_required' as const, email: result.email };
    }
    if (result.kind === 'session') {
      return this.establish(reply, result.opened);
    }
    applyOrganizationCookie(reply, cookieSecure(this.env.PUBLIC_ORIGIN), result.organizationId);
    return result.body;
  }

  private establish(reply: FastifyReply, opened: OpenedSession): SessionResponse {
    applySessionCookies(
      reply,
      cookieSecure(this.env.PUBLIC_ORIGIN),
      opened.sessionToken,
      opened.csrfToken,
      opened.organizationId,
    );
    return opened.body;
  }
}

@Controller('internal')
@UseGuards(SessionGuard)
export class AccountController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly teams: TeamService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('auth/session')
  session(@Req() request: FastifyRequest) {
    return current(request).body;
  }

  @Post('auth/signout')
  @HttpCode(200)
  async signOut(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const state = current(request);
    await this.auth.signOut(state, clientInfo(request));
    clearAuthCookies(reply, cookieSecure(this.env.PUBLIC_ORIGIN));
    return { status: 'ok' as const, message: 'Signed out.' };
  }

  @Get('sessions')
  listSessions(@Req() request: FastifyRequest) {
    return this.sessions.list(current(request));
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  async revokeSession(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
  ) {
    const state = current(request);
    const result = await this.sessions.revoke(
      state,
      parseInput(idParamSchema, params).id,
      clientInfo(request).ip,
    );
    if (result.current) {
      clearAuthCookies(reply, cookieSecure(this.env.PUBLIC_ORIGIN));
    }
    return { status: 'ok' as const, message: 'Session revoked.' };
  }

  @Post('profile/totp/setup')
  @HttpCode(200)
  setupTotp(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parseInput(changePasswordSchema.pick({ currentPassword: true }), body);
    return this.auth.setupTotp(current(request), input.currentPassword);
  }

  @Post('profile/totp/confirm')
  @HttpCode(200)
  confirmTotp(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.auth.confirmTotp(
      current(request),
      parseInput(totpCodeSchema, body).code,
      clientInfo(request),
    );
  }

  @Post('profile/totp/disable')
  @HttpCode(200)
  disableTotp(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parseInput(disableTotpSchema, body);
    return this.auth.disableTotp(
      current(request),
      input.currentPassword,
      input.code,
      clientInfo(request),
    );
  }

  @Patch('profile')
  updateProfile(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.auth.updateProfile(current(request), parseInput(profileSchema, body).name);
  }

  @Post('profile/password')
  @HttpCode(200)
  async changePassword(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parseInput(changePasswordSchema, body);
    await this.auth.changePassword(
      current(request),
      input.currentPassword,
      input.password,
      clientInfo(request),
    );
    return { status: 'ok' as const, message: 'Password updated.' };
  }

  @Patch('profile/details')
  updateDetails(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.auth.updateDetails(current(request), parseInput(detailsSchema, body));
  }

  @Post('profile/phone')
  @HttpCode(200)
  startPhone(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.auth.startPhone(
      current(request),
      parseInput(phoneStartSchema, body).phone,
      clientInfo(request),
    );
  }

  @Post('profile/phone/confirm')
  @HttpCode(200)
  confirmPhone(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.auth.confirmPhone(
      current(request),
      parseInput(phoneConfirmSchema, body).code,
      clientInfo(request),
    );
  }

  @Patch('organization')
  updateOrganization(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.auth.updateBusiness(
      current(request),
      parseInput(businessSettingsSchema, body),
      clientInfo(request),
    );
  }

  @Post('organization/switch')
  @HttpCode(200)
  async switchOrganization(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const organizationId = parseInput(switchOrganizationSchema, body).organizationId;
    const session = await this.teams.switchOrganization(current(request), organizationId);
    applyOrganizationCookie(
      reply,
      cookieSecure(this.env.PUBLIC_ORIGIN),
      session.organization?.id ?? null,
    );
    return session;
  }

  @Post('organization/delete')
  @HttpCode(200)
  async deleteOrganization(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const session = await this.teams.deleteOrganization(
      current(request),
      parseInput(deleteOrganizationSchema, body).confirmName,
      clientInfo(request),
    );
    applyOrganizationCookie(
      reply,
      cookieSecure(this.env.PUBLIC_ORIGIN),
      session.organization?.id ?? null,
    );
    return session;
  }

  @Get('members')
  members(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.teams.list(
      current(request),
      parseInput(memberListQuerySchema, firstQueryValues(query)),
    );
  }

  @Patch('members/:id')
  changeRole(@Req() request: FastifyRequest, @Param() params: unknown, @Body() body: unknown) {
    return this.teams.changeRole(
      current(request),
      parseInput(idParamSchema, params).id,
      parseInput(changeRoleSchema, body).role,
      clientInfo(request),
    );
  }

  @Delete('members/:id')
  @HttpCode(200)
  removeMember(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.teams.remove(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Post('members/:id/transfer')
  @HttpCode(200)
  transfer(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.teams.transfer(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Post('invitations')
  @HttpCode(200)
  invite(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.teams.invite(current(request), parseInput(inviteSchema, body), clientInfo(request));
  }

  @Post('invitations/:id/resend')
  @HttpCode(200)
  resendInvite(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.teams.resend(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Delete('invitations/:id')
  @HttpCode(200)
  revokeInvite(@Req() request: FastifyRequest, @Param() params: unknown) {
    return this.teams.revoke(
      current(request),
      parseInput(idParamSchema, params).id,
      clientInfo(request),
    );
  }

  @Get('audit')
  audit(@Req() request: FastifyRequest, @Query() query: unknown) {
    const parsed = parseInput(auditListQuerySchema, firstQueryValues(query));
    return this.teams.listAudit(current(request), parsed.page, parsed.pageSize);
  }
}
