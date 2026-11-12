import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

async function openDashboardLink(page: Page, name: string): Promise<void> {
  const visible = page.getByRole('link', { name, exact: true }).filter({ visible: true });
  if ((await visible.count()) === 0) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).click();
}

test('sends an approved template and shows it as delivered', async ({ page }, testInfo) => {
  const phone = '+4915123456789';
  const templateName = `Hello ${testInfo.project.name}`;
  await page.goto('/signin');
  await page.getByLabel('Email').fill('admin@smsvio.test');
  await page.getByLabel('Password').fill('smsvio-demo-local');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');

  await openDashboardLink(page, 'Senders');
  const countryCell = page.getByRole('cell', { name: 'Germany', exact: true });
  if ((await countryCell.count()) === 0) {
    await page.getByRole('button', { name: 'Add country' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a country' });
    await dialog.getByLabel('Country').fill('Germany');
    await dialog.getByRole('option', { name: 'Germany' }).click();
    await dialog.getByRole('button', { name: 'Enable country' }).click();
  }
  await expect(countryCell).toBeVisible();

  await openDashboardLink(page, 'Admin');
  const demo = page.getByRole('row', { name: /SMSVIO Demo/ });
  const activate = demo.getByRole('button', { name: 'Activate' });
  if (await activate.isVisible()) {
    await activate.click();
    await expect(demo.getByRole('button', { name: 'Suspend' })).toBeVisible();
  }
  await demo.getByRole('button', { name: 'Credit' }).click();
  const adjust = page.getByRole('dialog', { name: /Adjust / });
  await adjust.getByLabel('Amount').fill('1.00');
  await adjust.getByLabel('Reason').fill(`Send ${testInfo.project.name}`);
  await adjust.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Credited 1.00 USD.' })).toBeVisible();

  await openDashboardLink(page, 'Templates');
  await page.getByRole('link', { name: 'From scratch' }).first().click();
  await page.getByLabel('Name').fill(templateName);
  await page.getByLabel('Message').fill('Hello from SMSVIO');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/dashboard\/templates\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();

  await openDashboardLink(page, 'Send');
  await page.getByLabel('Template').selectOption({ label: templateName });
  await page.getByLabel('Phone number').fill(phone);
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText('delivered', { exact: true })).toBeVisible({ timeout: 20_000 });

  await openDashboardLink(page, 'Messages');
  await page.getByLabel('Search').fill(phone);
  await expect(page.getByRole('cell', { name: phone })).toBeVisible();
  await page.getByRole('cell', { name: phone }).first().click();
  await expect(page.getByRole('dialog').getByText('Hello from SMSVIO')).toBeVisible();
});
