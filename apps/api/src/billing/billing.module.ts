import { Module } from '@nestjs/common';

import { SessionGuard } from '../accounts/guards.js';
import { SessionService } from '../accounts/session.service.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [MessagingModule],
  controllers: [BillingController],
  providers: [BillingService, SessionGuard, SessionService],
})
export class BillingModule {}
