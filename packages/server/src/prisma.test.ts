import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

const fakeClient = { $disconnect: vi.fn(() => Promise.resolve()) };
const createPrismaClient = vi.fn(() => fakeClient);

vi.mock('@smsvio/db', () => ({ createPrismaClient }));

const { PRISMA, PrismaModule } = await import('./prisma.js');

describe('PrismaModule', () => {
  it('creates the client from options and disconnects on shutdown', async () => {
    const options = { connectionString: 'postgresql://u:p@db:5432/smsvio', maxConnections: 5 };
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule.forRoot(options)],
    }).compile();
    moduleRef.enableShutdownHooks();

    expect(moduleRef.get(PRISMA)).toBe(fakeClient);
    expect(createPrismaClient).toHaveBeenCalledWith(options);

    await moduleRef.close();
    expect(fakeClient.$disconnect).toHaveBeenCalledOnce();
  });
});
