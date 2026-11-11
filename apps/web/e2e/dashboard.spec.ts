import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

const mailSink = join(tmpdir(), 'smsvio-e2e-mail');
const tokenPattern = /token=([A-Za-z0-9_-]+)/;

async function openDashboardLink(page: Page, name: string): Promise<void> {
  const visible = page.getByRole('link', { name, exact: true }).filter({ visible: true });
  if ((await visible.count()) === 0) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).click();
}

function tokenFor(email: string): string {
  for (const file of readdirSync(mailSink)) {
    const raw = readFileSync(join(mailSink, file), 'utf8');
    if (raw.includes(email)) {
      return tokenPattern.exec(raw)?.[1] ?? '';
    }
  }
  return '';
}

test.describe('signed-in dashboard', () => {
  test('signs in to the demo organization and opens the shell', async ({ page }) => {
    await page.goto('/signin');
    await page.getByLabel('Email').fill('admin@smsvio.test');
    await page.getByLabel('Password').fill('smsvio-demo-local');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await openDashboardLink(page, 'Users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await openDashboardLink(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Search' }).click();
    await page
      .getByRole('dialog', { name: 'Command palette' })
      .getByRole('button', { name: 'Overview' })
      .click();
    await expect(page).toHaveURL('/dashboard');
  });
});

test.describe('account signup', () => {
  test('creates an account and confirms the emailed link', async ({ page }, testInfo) => {
    const email = `owner-${testInfo.project.name}-${String(Date.now())}@example.com`;
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Case Owner');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('smsvio-phase1-pass');
    await page.getByLabel('Organization').fill('Case Org');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Check your email for the next step.')).toBeVisible();

    await expect.poll(() => tokenFor(email)).not.toBe('');
    await page.goto(`/verify-email?token=${tokenFor(email)}`);
    await expect(page).toHaveURL('/dashboard');
  });
});
