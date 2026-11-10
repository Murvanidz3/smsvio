import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Optional here so `prisma generate` works without a database; migrate commands fail fast
    // with Prisma's own error when it is missing.
    url: process.env.DATABASE_URL,
  },
});
