import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

export { Prisma, PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
}

export function createPrismaClient({
  connectionString,
  maxConnections = 10,
}: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: maxConnections });
  return new PrismaClient({ adapter });
}
