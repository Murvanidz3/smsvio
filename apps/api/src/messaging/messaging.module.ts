import { Module } from '@nestjs/common';

import { SessionGuard } from '../accounts/guards.js';
import { SessionService } from '../accounts/session.service.js';
import { AdminController } from './admin.controller.js';
import { LedgerService } from './ledger.service.js';
import { OrganizationAdminService } from './organization-admin.service.js';
import { PricingService } from './pricing.service.js';
import { ProviderAdminService } from './provider-admin.service.js';
import { RateAdminService } from './rate-admin.service.js';
import { SendersController } from './senders.controller.js';
import { SenderService } from './senders.service.js';

@Module({
  controllers: [AdminController, SendersController],
  providers: [
    SessionGuard,
    SessionService,
    LedgerService,
    PricingService,
    ProviderAdminService,
    RateAdminService,
    OrganizationAdminService,
    SenderService,
  ],
  exports: [LedgerService],
})
export class MessagingModule {}
