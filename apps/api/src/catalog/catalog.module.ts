import { Module } from '@nestjs/common';

import { SessionGuard } from '../accounts/guards.js';
import { SessionService } from '../accounts/session.service.js';
import { RateLimiter } from '../security/rate-limit.js';
import { CatalogController } from './catalog.controller.js';
import { ContactService } from './contacts.service.js';
import { LookupService } from './lookup.service.js';
import { TemplateService } from './templates.service.js';

@Module({
  controllers: [CatalogController],
  providers: [
    ContactService,
    TemplateService,
    LookupService,
    SessionGuard,
    SessionService,
    RateLimiter,
  ],
})
export class CatalogModule {}
