import { Module } from '@nestjs/common';

import { SessionGuard } from '../accounts/guards.js';
import { SessionService } from '../accounts/session.service.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { RateLimiter } from '../security/rate-limit.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { DeveloperController } from './developer.controller.js';
import { ApiKeyService } from './keys.service.js';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { WebhookService } from './webhooks.service.js';

@Module({
  imports: [CatalogModule, MessagingModule],
  controllers: [DeveloperController, PublicController],
  providers: [
    ApiKeyService,
    WebhookService,
    PublicService,
    ApiKeyGuard,
    SessionGuard,
    SessionService,
    RateLimiter,
  ],
})
export class DeveloperModule {}
