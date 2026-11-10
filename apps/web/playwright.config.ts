import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${String(port)}`;
const isCi = Boolean(process.env.CI);

const viewports = {
  desktop: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  mobile: devices['Pixel 7'],
} as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: (['desktop', 'mobile'] as const).flatMap((size) =>
    (['light', 'dark'] as const).map((colorScheme) => ({
      name: `${size}-${colorScheme}`,
      use: { ...viewports[size], colorScheme },
    })),
  ),
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: 'node scripts/start-standalone.mjs',
          url: `${baseURL}/signin`,
          env: { PORT: String(port), HOSTNAME: '127.0.0.1' },
          reuseExistingServer: !isCi,
          timeout: 60_000,
        },
      }),
});
