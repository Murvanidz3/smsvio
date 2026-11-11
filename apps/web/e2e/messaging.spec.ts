import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

const destinations: Record<string, { iso: string; name: string }> = {
  'desktop-light': { iso: 'DE', name: 'Germany' },
  'desktop-dark': { iso: 'FR', name: 'France' },
  'mobile-light': { iso: 'JP', name: 'Japan' },
  'mobile-dark': { iso: 'AU', name: 'Australia' },
};

async function openDashboardLink(page: Page, name: string): Promise<void> {
  const visible = page.getByRole('link', { name, exact: true }).filter({ visible: true });
  if ((await visible.count()) === 0) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).click();
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill('admin@smsvio.test');
  await page.getByLabel('Password').fill('smsvio-demo-local');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
}

async function enableCountry(page: Page, name: string, activate: 'click' | 'enter'): Promise<void> {
  await openDashboardLink(page, 'Senders');
  await expect(page.getByRole('heading', { name: 'Senders', exact: true })).toBeVisible();
  await expect(page.getByText('The shared number is 12025550199.')).toBeVisible();
  const countryCell = page.getByRole('cell', { name });
  if ((await countryCell.count()) === 0) {
    await page.getByRole('button', { name: 'Add country' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a country' });
    await dialog.getByLabel('Country').fill(name);
    await dialog.getByRole('option', { name }).click();
    const enable = dialog.getByRole('button', { name: 'Enable country' });
    await expect(enable).toBeEnabled();
    if (activate === 'enter') {
      await enable.focus();
      await page.keyboard.press('Enter');
    } else {
      await enable.click();
    }
  }
  await expect(countryCell).toBeVisible();
}

async function creditOneDollar(
  page: Page,
  reason: string,
  activate: 'click' | 'enter',
): Promise<void> {
  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible();
  await page.getByRole('button', { name: 'Credit' }).first().click();
  const adjust = page.getByRole('dialog', { name: /Adjust / });
  await adjust.getByLabel('Amount').fill('1.00');
  await adjust.getByLabel('Reason').fill(reason);
  const apply = adjust.getByRole('button', { name: 'Apply' });
  if (activate === 'enter') {
    await apply.focus();
    await page.keyboard.press('Enter');
  } else {
    await apply.click();
  }
  await expect(page.getByRole('status').filter({ hasText: 'Credited 1.00 USD.' })).toBeVisible();
}

test.describe('senders and admin pricing', () => {
  test.describe.configure({ mode: 'serial' });

  test('enables a country and shows the priced route', async ({ page }, testInfo) => {
    const destination = destinations[testInfo.project.name] ?? destinations['desktop-light'];
    if (destination === undefined) {
      throw new Error('Missing destination.');
    }
    await signIn(page);
    await enableCountry(page, destination.name, 'click');

    await creditOneDollar(page, 'Phase 3 balance check', 'click');

    await page.getByRole('link', { name: 'Providers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'mock', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Routes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Routes' })).toBeVisible();
    await page.getByLabel('Search').fill(destination.name);
    await expect(page.getByRole('cell', { name: '50% provider' })).toBeVisible();

    await page.getByRole('link', { name: 'Rates', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rates' })).toBeVisible();
    await page.getByLabel('Search').fill(destination.name);
    const rateRow = page.getByRole('row', { name: destination.name });
    await expect(rateRow.getByRole('cell', { name: 'computed', exact: true })).toBeVisible();
    await expect(rateRow.getByRole('cell', { name: '0.0150' })).toBeVisible();
  });

  test('enables a country and credits a balance with Enter', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', 'Enter is covered once, on desktop');
    await signIn(page);
    await enableCountry(page, 'Italy', 'enter');
    await creditOneDollar(page, 'Phase 3 keyboard check', 'enter');
  });
});
