import { Controller, Get, Header, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { clientInfo } from '../http/client.js';
import { PublicRatesService } from './rates.service.js';

@Controller('public')
export class PublicRatesController {
  constructor(private readonly rates: PublicRatesService) {}

  @Get('rates')
  @Header('Cache-Control', 'public, max-age=600')
  list(@Req() request: FastifyRequest) {
    return this.rates.list(clientInfo(request).ip);
  }
}
