import { mkdirSync } from 'node:fs';

import { expect, test } from './fixtures';

test.describe('marketing interactions', () => {
  test('get started opens sign up', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('main').getByRole('link', { name: 'Get started' }).click();
    await expect(page).toHaveURL('/signup');
  });

  test('header sign in opens the sign-in page', async ({ page }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('desktop'),
      'On a narrow screen, sign in lives in the menu.',
    );
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Sign in' })
      .click();
    await expect(page).toHaveURL('/signin');
  });

  test('counts a Georgian letter as Unicode 70', async ({ page }) => {
    await page.goto('/');
    const status = page.getByTestId('segment-counter');
    await expect(status).toContainText('GSM-7');
    await expect(status).toContainText('160');

    await page.getByLabel('Message').fill('ა');

    await expect(status).toContainText('Unicode');
    await expect(status).toContainText('70');
    await expect(status).not.toContainText('160');
  });

  test('previews a delivery without sending', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Preview delivery' }).click();
    await expect(page.getByTestId('delivery-status')).toHaveText('Delivered');
    await expect(page.getByText('Preview only. Nothing is sent.')).toBeVisible();
  });

  test('shows Delivered immediately when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('button', { name: 'Preview delivery' }).click();
    await expect(page.getByTestId('delivery-status')).toHaveText('Delivered', { timeout: 800 });
  });

  test('opens the menu on a narrow screen', async ({ page }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('mobile'),
      'The menu button is for narrow screens.',
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await menu.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/signin');
  });

  test('offers contact sales and the country count', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Contact sales' }).first()).toHaveAttribute(
      'href',
      'https://t.me/CFX555',
    );
    await expect(page.getByText(/countries · Pay as you go · No monthly fee/)).toBeVisible();
    const footer = page.locator('footer');
    await expect(footer.getByText('SMSVIO Digital', { exact: true })).toBeVisible();
    await expect(footer.getByText(/© \d{4} SMSVIO Digital/)).toBeVisible();
  });

  test('replaces sign in when a session cookie is present', async ({ page }) => {
    await page.context().addCookies([
      {
        name: 'smsvio_session',
        value: 'present',
        domain: '127.0.0.1',
        path: '/',
      },
    ]);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Open dashboard' }).first()).toHaveAttribute(
      'href',
      '/dashboard',
    );
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Get started' })).toHaveCount(0);
  });

  test('saves review screenshots', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-light',
      'One set of review screenshots is enough.',
    );
    mkdirSync('test-results/marketing', { recursive: true });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: `test-results/marketing/home-${String(width)}.png`,
        fullPage: true,
      });
    }
  });
});
