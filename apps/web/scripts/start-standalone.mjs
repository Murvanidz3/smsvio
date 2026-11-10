import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standaloneAppDir = path.join(appDir, '.next/standalone/apps/web');
const serverEntry = path.join(standaloneAppDir, 'server.js');

if (!existsSync(serverEntry)) {
  process.stderr.write('Standalone build not found. Run `pnpm build` first.\n');
  process.exit(1);
}

cpSync(path.join(appDir, '.next/static'), path.join(standaloneAppDir, '.next/static'), {
  recursive: true,
});
const publicDir = path.join(appDir, 'public');
if (existsSync(publicDir)) {
  cpSync(publicDir, path.join(standaloneAppDir, 'public'), { recursive: true });
}

process.env.PORT ??= '3000';
process.env.HOSTNAME ??= '127.0.0.1';
await import(pathToFileURL(serverEntry).href);
