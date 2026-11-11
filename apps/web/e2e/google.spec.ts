import { expect, test } from './fixtures';

test.describe('Google sign-in when email is disabled', () => {
  test('hides email registration and signs in with Google', async ({ page }, testInfo) => {
    await page.goto('/signup');
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveCount(0);
    await expect(page.getByText('Email registration is coming soon.')).toBeVisible();

    await page.goto('/signin');
    await expect(page.getByRole('link', { name: 'Forgot your password?' })).toHaveCount(0);
    await expect(page.getByText('Email registration is coming soon.')).toBeVisible();
    await page.getByRole('link', { name: 'Continue with Google' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    const organization = page.getByLabel('Organization');
    if (await organization.isVisible()) {
      await organization.fill(`Google ${testInfo.project.name}`);
      await page.getByRole('button', { name: 'Create organization' }).click();
    }
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  });
});
