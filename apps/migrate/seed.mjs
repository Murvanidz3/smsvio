import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const monorepoDb = join(here, '../../packages/db');
const prismaCwd = existsSync(join(process.cwd(), 'prisma.config.ts'))
  ? process.cwd()
  : existsSync(join(monorepoDb, 'prisma.config.ts'))
    ? monorepoDb
    : process.cwd();
const prismaEntry = join(dirname(require.resolve('prisma/package.json')), 'build/index.js');
const migrated = spawnSync(process.execPath, [prismaEntry, 'migrate', 'deploy'], {
  cwd: prismaCwd,
  stdio: 'inherit',
});
if (migrated.status !== 0) {
  process.exit(migrated.status ?? 1);
}

const { ARGON2ID_OPTIONS, LOCAL_DEMO_PASSWORD } = await import('@smsvio/shared');
const { countrySeedRows } = await import('@smsvio/shared/phone');
const { createPrismaClient } = await import('@smsvio/db');
const argon2 = (await import('argon2')).default;
const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL ?? '' });

try {
  await prisma.country.createMany({ data: countrySeedRows(), skipDuplicates: true });

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  const skipAdmin = email === undefined || email === '' || password === '';
  if (!skipAdmin && process.env.NODE_ENV === 'production' && password === LOCAL_DEMO_PASSWORD) {
    console.error('Refusing to seed the local demo password in production.');
    process.exitCode = 1;
  } else if (!skipAdmin && password.length < 10) {
    console.error('SEED_ADMIN_PASSWORD must be at least 10 characters.');
    process.exitCode = 1;
  } else if (!skipAdmin) {
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: ARGON2ID_OPTIONS.memoryCost,
      timeCost: ARGON2ID_OPTIONS.timeCost,
      parallelism: ARGON2ID_OPTIONS.parallelism,
    });
    const name = process.env.SEED_ADMIN_NAME?.trim() || 'SMSVIO Admin';
    const organizationName = process.env.SEED_ORG_NAME?.trim() || 'SMSVIO Demo';
    const existing = await prisma.user.findUnique({ where: { email } });
    const user =
      existing ??
      (await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          emailVerifiedAt: new Date(),
          isPlatformAdmin: true,
          timezone: 'UTC',
        },
      }));
    if (existing !== null) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { isPlatformAdmin: true, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
      });
    }
    const memberships = await prisma.membership.count({ where: { userId: user.id } });
    if (memberships === 0) {
      const organization = await prisma.organization.create({
        data: { name: organizationName, timezone: 'UTC' },
      });
      await prisma.membership.create({
        data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
      });
    }
  }
} finally {
  await prisma.$disconnect();
}
