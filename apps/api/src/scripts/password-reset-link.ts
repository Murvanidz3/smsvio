import { createPrismaClient } from '@smsvio/db';

import { buildPasswordResetLink } from '../accounts/password-reset-link.js';

const email = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
const origin = process.env.PUBLIC_ORIGIN;

if (
  email === undefined ||
  email.trim() === '' ||
  databaseUrl === undefined ||
  origin === undefined
) {
  process.stderr.write('Usage: node dist/scripts/password-reset-link.js <email>\n');
  process.stderr.write('DATABASE_URL and PUBLIC_ORIGIN must be set.\n');
  process.exit(1);
}

const prisma = createPrismaClient({ connectionString: databaseUrl });

try {
  const link = await buildPasswordResetLink(prisma, origin, email);
  process.stdout.write(`${link}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Could not create a reset link.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
