import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

async function openDashboardLink(page: Page, name: string): Promise<void> {
  const visible = page.getByRole('link', { name, exact: true }).filter({ visible: true });
  if ((await visible.count()) === 0) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).click();
}

function testPhone(project: string): string {
  const seed = `${project}-${Date.now().toString(36)}-${Math.random().toString(36)}`;
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  }
  return `+1415555${String(hash % 10000).padStart(4, '0')}`;
}

test.describe('catalog', () => {
  test('creates a contact, approves a template, and looks up a number', async ({
    page,
  }, testInfo) => {
    const phone = testPhone(testInfo.project.name);
    await page.goto('/signin');
    await page.getByLabel('Email').fill('admin@smsvio.test');
    await page.getByLabel('Password').fill('smsvio-demo-local');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard');

    await openDashboardLink(page, 'Contacts');
    await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create contact' }).click();
    const create = page.getByRole('dialog', { name: 'Create contact' });
    await create.getByLabel('Phone').fill(phone);
    await create.getByLabel('Name').fill(`Catalog ${testInfo.project.name}`);
    await create.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: phone })).toBeVisible();
    await page.getByRole('cell', { name: phone }).click();
    await expect(page.getByRole('dialog', { name: 'Contact' })).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Contact' })
      .getByRole('button', { name: 'Delete contact' })
      .click();
    await page
      .getByRole('dialog', { name: 'Delete contact' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByRole('cell', { name: phone })).toHaveCount(0);

    await openDashboardLink(page, 'Templates');
    await page.getByRole('button', { name: 'Gallery' }).click();
    const gallery = page.getByRole('dialog', { name: 'Sample gallery' });
    await gallery
      .locator('div')
      .filter({ hasText: 'Sign-in code' })
      .getByRole('button', { name: 'Use' })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard\/templates\/[0-9a-f-]+$/);
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();

    await openDashboardLink(page, 'Number lookup');
    await page.getByLabel('Number').fill('+14155552671');
    await page.getByRole('button', { name: 'Look up' }).click();
    const result = page.locator('dd');
    await expect(result.filter({ hasText: 'United States' })).toBeVisible();
    await expect(result.filter({ hasText: 'Los Angeles' })).toBeVisible();
    await expect(result.filter({ hasText: '+14155552671' })).toBeVisible();
  });
});
