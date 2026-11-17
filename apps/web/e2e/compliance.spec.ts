import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

async function openDashboardLink(page: Page, name: string): Promise<void> {
  const visible = page.getByRole('link', { name, exact: true }).filter({ visible: true });
  if ((await visible.count()) === 0) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).click();
}

test('opens compliance from the dashboard', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/signin');
  await page.getByLabel('Email').fill('admin@smsvio.test');
  await page.getByLabel('Password').fill('smsvio-demo-local');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
  await openDashboardLink(page, 'Compliance');
  await expect(page.getByRole('heading', { name: 'Compliance' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto-replies' })).toBeVisible();
  await page.getByRole('button', { name: 'Auto-replies' }).click();
  await expect(page.getByText('OPT_OUT')).toBeVisible();
});
