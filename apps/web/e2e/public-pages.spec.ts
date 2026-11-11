import { expect, test } from './fixtures';

test.describe('landing page', () => {
  test('shows the placeholder and links to sign in', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    await expect(page).toHaveTitle('SMSVIO — Business SMS platform');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'SMSVIO home' })).toBeVisible();

    await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/signin');
    await expect(page.getByRole('heading', { name: 'Sign in to SMSVIO' })).toBeVisible();
  });

  test('follows the system colour scheme and toggles it', async ({ page }, testInfo) => {
    await page.goto('/');
    const html = page.locator('html');
    const systemDark = testInfo.project.use.colorScheme === 'dark';

    await expect(html).toHaveClass(systemDark ? /\bdark\b/ : /\blight\b/);
    await page.getByTestId('theme-toggle').click();
    await expect(html).toHaveClass(systemDark ? /\blight\b/ : /\bdark\b/);

    await page.reload();
    await expect(html).toHaveClass(systemDark ? /\blight\b/ : /\bdark\b/);
  });

  test('fits the viewport without horizontal scrolling', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('sign-in shell', () => {
  test('renders the shell and is excluded from indexing', async ({ page }) => {
    const response = await page.goto('/signin');
    expect(response?.status()).toBe(200);

    await expect(page).toHaveTitle('Sign in · SMSVIO');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    await page.getByRole('link', { name: 'SMSVIO home' }).click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('security headers', () => {
  test('serves a nonce-based content security policy', async ({ page }) => {
    const first = await page.goto('/');
    const second = await page.goto('/');
    const firstCsp = first?.headers()['content-security-policy'] ?? '';
    const secondCsp = second?.headers()['content-security-policy'] ?? '';

    expect(firstCsp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(firstCsp).toContain("frame-ancestors 'none'");
    expect(firstCsp).not.toContain('unsafe-eval');
    expect(firstCsp).not.toBe(secondCsp);
  });
});

test.describe('unknown routes', () => {
  test.use({ expectedConsoleErrors: [/the server responded with a status of 404/] });

  test('return a branded 404 page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});
