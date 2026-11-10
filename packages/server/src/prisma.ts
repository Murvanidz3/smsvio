import {
  Global,
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@smsvio/db';

export const PRISMA = Symbol('PRISMA');

export interface PrismaModuleOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
}

@Injectable()
class PrismaShutdown implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

@Global()
@Module({})
export class PrismaModule {
  static forRoot(options: PrismaModuleOptions): DynamicModule {
    return {
      module: PrismaModule,
      providers: [
        { provide: PRISMA, useFactory: () => createPrismaClient(options) },
        PrismaShutdown,
      ],
      exports: [PRISMA],
    };
  }
}
