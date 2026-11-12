import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

const mailSink = join(tmpdir(), 'smsvio-e2e-mail');
const tokenPattern = /token=([A-Za-z0-9_-]+)/;

const destinations: Record<string, string> = {
  'desktop-light': 'Canada',
  'desktop-dark': 'Spain',
  'mobile-light': 'Italy',
  'mobile-dark': 'Brazil',
};

function tokenFor(email: string): string {
  for (const file of readdirSync(mailSink)) {
    const raw = readFileSync(join(mailSink, file), 'utf8');
    if (raw.includes(email)) {
      return tokenPattern.exec(raw)?.[1] ?? '';
    }
  }
  return '';
}

async function openDashboardLink(page: Page, name: string): Promise<void> {
  const visible = page.getByRole('link', { name, exact: true }).filter({ visible: true });
  if ((await visible.count()) === 0) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page.getByRole('link', { name, exact: true }).filter({ visible: true }).click();
}

test('a new organization owner enables a country from the visible controls', async ({
  page,
}, testInfo) => {
  const country = destinations[testInfo.project.name] ?? 'Canada';
  const email = `country-${testInfo.project.name}-${String(Date.now())}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('New Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('smsvio-phase1-pass');
  await page.getByLabel('Organization').fill(`New ${testInfo.project.name}`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your email for the next step.')).toBeVisible();
  await expect.poll(() => tokenFor(email)).not.toBe('');
  await page.goto(`/verify-email?token=${tokenFor(email)}`);
  await expect(page).toHaveURL('/dashboard');

  await openDashboardLink(page, 'Senders');
  await expect(page.getByRole('heading', { name: 'Senders', exact: true })).toBeVisible();
  await expect(page.getByText('The shared number is 12025550199.')).toBeVisible();
  const addCountry = page.getByRole('button', { name: 'Add country' }).filter({ visible: true });
  const requestSender = page
    .getByRole('button', { name: 'Request sender ID' })
    .filter({ visible: true });
  await expect(addCountry).toBeEnabled();
  await expect(requestSender).toBeEnabled();
  await addCountry.click();

  const dialog = page.getByRole('dialog', { name: 'Add a country' });
  await dialog.getByLabel('Country').fill(country);
  await dialog.getByRole('option', { name: country }).click();
  await dialog.getByRole('button', { name: 'Enable country' }).click();
  await expect(page.getByRole('cell', { name: country })).toBeVisible();
});
