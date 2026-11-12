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
const { countrySeedRows, networkSeedRows } = await import('@smsvio/shared/phone');
const { MOCK_CALLBACK_SECRET, hashProviderSecret } = await import('@smsvio/shared/provider');
const { createPrismaClient } = await import('@smsvio/db');
const argon2 = (await import('argon2')).default;
const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL ?? '' });

try {
  await prisma.country.createMany({ data: countrySeedRows(), skipDuplicates: true });
  await prisma.network.createMany({ data: networkSeedRows(), skipDuplicates: true });

  const billing = await import('@smsvio/shared/billing');
  const setting = await prisma.platformSetting.upsert({
    where: { id: billing.PLATFORM_SETTING_ID },
    create: {
      id: billing.PLATFORM_SETTING_ID,
      defaultDailySpendCapMicros: billing.DEFAULT_DAILY_SPEND_CAP_MICROS,
      sharedSender: billing.PLATFORM_SENDER_VALUE,
    },
    update: {},
  });
  if (setting.sharedSender === null) {
    await prisma.platformSetting.update({
      where: { id: billing.PLATFORM_SETTING_ID },
      data: { sharedSender: billing.PLATFORM_SENDER_VALUE },
    });
  }
  const provider = await prisma.provider.upsert({
    where: { code: billing.MOCK_PROVIDER_CODE },
    create: {
      code: billing.MOCK_PROVIDER_CODE,
      type: 'MOCK',
      status: 'ACTIVE',
      maxTps: billing.MOCK_SEED_MAX_TPS,
      markupPercent: billing.MOCK_SEED_MARKUP_PERCENT,
    },
    update: {},
  });
  if (provider.callbackSecretHash === null) {
    await prisma.provider.update({
      where: { id: provider.id },
      data: { callbackSecretHash: hashProviderSecret(MOCK_CALLBACK_SECRET) },
    });
  }
  const countries = await prisma.country.findMany({ select: { iso2: true } });
  for (const country of countries) {
    const existing = await prisma.route.findFirst({
      where: { countryIso2: country.iso2, mccmnc: null, providerId: provider.id },
    });
    if (existing !== null) {
      continue;
    }
    await prisma.route.create({
      data: {
        countryIso2: country.iso2,
        providerId: provider.id,
        priority: billing.MOCK_SEED_PRIORITY,
        weight: 1,
        costMicros: billing.MOCK_SEED_COST_MICROS,
        enabled: true,
      },
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  const skipAdmin = email === undefined || email === '' || password === '';
  const refuseDemoPassword =
    !skipAdmin && process.env.NODE_ENV === 'production' && password === LOCAL_DEMO_PASSWORD;
  const shortPassword = !skipAdmin && !refuseDemoPassword && password.length < 10;
  if (refuseDemoPassword) {
    console.error('Refusing to seed the local demo password in production.');
  } else if (shortPassword) {
    console.error('SEED_ADMIN_PASSWORD must be at least 10 characters.');
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

  if (email !== undefined && email !== '') {
    const operator = await prisma.user.findUnique({ where: { email } });
    if (operator !== null) {
      const memberships = await prisma.membership.count({ where: { userId: operator.id } });
      if (memberships === 0) {
        const organization = await prisma.organization.create({
          data: { name: process.env.SEED_ORG_NAME?.trim() || 'SMSVIO', timezone: 'UTC' },
        });
        await prisma.membership.create({
          data: { userId: operator.id, organizationId: organization.id, role: 'OWNER' },
        });
      }
    }
  }
} finally {
  await prisma.$disconnect();
}
