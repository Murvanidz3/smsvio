import { Module } from '@nestjs/common';

import { SessionGuard } from '../accounts/guards.js';
import { SessionService } from '../accounts/session.service.js';
import { API_ENV } from '../config.js';
import { MAILER, createMailer } from '../mail/mailer.js';
import { ComplianceController } from '../compliance/compliance.controller.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { OperatorController } from '../compliance/operator.controller.js';
import { OperatorService } from '../compliance/operator.service.js';
import { AdminController } from './admin.controller.js';
import { LedgerService } from './ledger.service.js';
import { OrganizationAdminService } from './organization-admin.service.js';
import { PricingService } from './pricing.service.js';
import { ProviderAdminService } from './provider-admin.service.js';
import { RateAdminService } from './rate-admin.service.js';
import { SendersController } from './senders.controller.js';
import { MessageQueryService } from './messages.service.js';
import { ExportsController } from './exports.controller.js';
import { ProviderHooksController } from './hooks.controller.js';
import { MessagesController } from './messages.controller.js';
import { SendService } from './send.service.js';
import { SentDmHooksController } from './sent-dm.controller.js';
import { SenderService } from './senders.service.js';

@Module({
  controllers: [
    AdminController,
    ComplianceController,
    OperatorController,
    SendersController,
    MessagesController,
    ProviderHooksController,
    SentDmHooksController,
    ExportsController,
  ],
  providers: [
    SessionGuard,
    SessionService,
    LedgerService,
    PricingService,
    ProviderAdminService,
    RateAdminService,
    OrganizationAdminService,
    ComplianceService,
    OperatorService,
    SenderService,
    SendService,
    MessageQueryService,
    { provide: MAILER, useFactory: createMailer, inject: [API_ENV] },
  ],
  exports: [LedgerService, SendService, PricingService, SenderService],
})
export class MessagingModule {}
