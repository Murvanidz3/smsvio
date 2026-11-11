import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function globalTeardown(): void {
  const pidFile = join(tmpdir(), 'smsvio-e2e-api.pid');
  try {
    const pid = Number(readFileSync(pidFile, 'utf8'));
    process.kill(pid);
  } catch {
    // The API was already running, or this platform could not signal it.
  }
  rmSync(pidFile, { force: true });
}
