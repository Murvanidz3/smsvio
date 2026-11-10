import { test as base, expect } from '@playwright/test';

interface ConsoleFixtures {
  expectedConsoleErrors: RegExp[];
  consoleProblems: string[];
}

export const test = base.extend<ConsoleFixtures>({
  expectedConsoleErrors: [[], { option: true }],
  consoleProblems: [
    async ({ page, expectedConsoleErrors }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        const kind = message.type();
        if (kind !== 'error' && kind !== 'warning') {
          return;
        }
        const text = message.text();
        if (!expectedConsoleErrors.some((pattern) => pattern.test(text))) {
          problems.push(`${kind}: ${text}`);
        }
      });
      page.on('pageerror', (error) => {
        problems.push(`pageerror: ${error.message}`);
      });
      await use(problems);
      expect(problems, 'browser console must stay free of errors and warnings').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
