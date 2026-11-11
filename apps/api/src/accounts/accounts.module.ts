import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { MAILER, createMailer } from '../mail/mailer.js';
import { RateLimiter } from '../security/rate-limit.js';
import { API_ENV } from '../config.js';
import {
  AccountController,
  AuthController,
  GoogleCallbackController,
} from './accounts.controller.js';
import { AuthService } from './auth.service.js';
import { OptionalSessionGuard, SessionGuard } from './guards.js';
import { MutationInterceptor } from './mutation.interceptor.js';
import { SessionService } from './session.service.js';
import { TeamService } from './team.service.js';

@Module({
  controllers: [AuthController, GoogleCallbackController, AccountController],
  providers: [
    RateLimiter,
    AuthService,
    SessionService,
    TeamService,
    SessionGuard,
    OptionalSessionGuard,
    { provide: MAILER, useFactory: createMailer, inject: [API_ENV] },
    { provide: APP_INTERCEPTOR, useClass: MutationInterceptor },
  ],
})
export class AccountsModule {}
