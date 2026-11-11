import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const pidFile = join(tmpdir(), 'smsvio-e2e-api.pid');
export const mailSinkDir = join(tmpdir(), 'smsvio-e2e-mail');

function loadEnvFile(): void {
  try {
    const text = readFileSync(join(root, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (
        match?.[1] !== undefined &&
        match[2] !== undefined &&
        process.env[match[1]] === undefined
      ) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    // CI provides the variables directly.
  }
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The process is still starting.
    }
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 300);
    });
  }
  throw new Error(`API did not become ready at ${url}`);
}

export default async function globalSetup(): Promise<void> {
  loadEnvFile();
  mkdirSync(mailSinkDir, { recursive: true });
  const port = process.env.PLAYWRIGHT_PORT ?? '3100';
  const apiPort = '4010';
  const healthUrl = `http://127.0.0.1:${apiPort}/healthz`;
  try {
    const existing = await fetch(healthUrl);
    if (existing.ok) {
      return;
    }
  } catch {
    // Start a local API for this run.
  }

  const seed = spawnSync(process.execPath, ['apps/migrate/seed.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL ?? 'admin@smsvio.test',
      SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD ?? 'smsvio-demo-local',
      SEED_ADMIN_NAME: process.env.SEED_ADMIN_NAME ?? 'SMSVIO Admin',
      SEED_ORG_NAME: process.env.SEED_ORG_NAME ?? 'SMSVIO Demo',
    },
  });
  if (seed.status !== 0) {
    throw new Error('Database migrate and seed failed.');
  }

  const child: ChildProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      API_HOST: '127.0.0.1',
      API_PORT: apiPort,
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY ?? 'ab'.repeat(32),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_FROM: process.env.SMTP_FROM ?? 'SMSVIO <noreply@smsvio.test>',
      MAIL_SINK_DIR: mailSinkDir,
      TRUST_PROXY_HOPS: '0',
    },
  });
  child.unref();
  if (child.pid !== undefined) {
    writeFileSync(pidFile, String(child.pid));
  }
  await waitForHealth(healthUrl);
}
