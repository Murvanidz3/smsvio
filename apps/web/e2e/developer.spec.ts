import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

async function openDashboardLink(page: Page, name: string): Promise<void> {
  const visible = page.getByRole('link', { name, exact: true }).filter({ visible: true });
  if ((await visible.count()) === 0) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).click();
}

test('creates an API key and a webhook', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const name = `CI ${testInfo.project.name} ${String(testInfo.retry)}`;
  await page.goto('/signin');
  await page.getByLabel('Email').fill('admin@smsvio.test');
  await page.getByLabel('Password').fill('smsvio-demo-local');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');

  await openDashboardLink(page, 'API keys');
  await expect(page.getByRole('heading', { name: 'API keys' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByText('Copy this key. It is shown only once.')).toBeVisible();
  await expect(page.getByRole('cell', { name })).toBeVisible();

  await openDashboardLink(page, 'Webhooks');
  await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('HTTPS URL').fill('https://example.com/hooks');
  await page.getByRole('button', { name: 'Add webhook' }).click();
  await expect(page.getByText('Copy this signing secret.')).toBeVisible();
  await page
    .getByRole('link', { name: /^[0-9a-f]{8}$/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Reveal secret' })).toBeVisible();
  await page.getByRole('button', { name: 'Send test event' }).click();
  await expect(page.getByRole('cell', { name: 'webhook.test' })).toBeVisible();

  await openDashboardLink(page, 'Documentation');
  await expect(page.getByRole('heading', { name: 'API reference' })).toBeVisible();
  await expect(page.getByText('Verify a webhook signature')).toBeVisible();
});
