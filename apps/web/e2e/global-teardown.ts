import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function globalTeardown(): void {
  const pidFile = join(tmpdir(), 'smsvio-e2e-api.pid');
  try {
    for (const line of readFileSync(pidFile, 'utf8').split('\n')) {
      const pid = Number(line);
      if (pid > 0) {
        process.kill(pid);
      }
    }
  } catch {
    // The API was already running, or this platform could not signal it.
  }
  rmSync(pidFile, { force: true });
}
