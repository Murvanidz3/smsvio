import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

async function openDashboardLink(page: Page, name: string): Promise<void> {
  const visible = page.getByRole('link', { name, exact: true }).filter({ visible: true });
  if ((await visible.count()) === 0) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).click();
}

test('shows overview, billing, and pricing', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/signin');
  await page.getByLabel('Email').fill('admin@smsvio.test');
  await page.getByLabel('Password').fill('smsvio-demo-local');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();

  await openDashboardLink(page, 'Billing');
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add credit' })).toBeVisible();

  await openDashboardLink(page, 'Pricing');
  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Calculator' })).toBeVisible();
});
