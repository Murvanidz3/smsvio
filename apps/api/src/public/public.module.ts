import { Module } from '@nestjs/common';

import { RateLimiter } from '../security/rate-limit.js';
import { PublicRatesController } from './rates.controller.js';
import { PublicRatesService } from './rates.service.js';

@Module({
  controllers: [PublicRatesController],
  providers: [PublicRatesService, RateLimiter],
})
export class PublicRatesModule {}
