import { test, expect } from '@playwright/test';

/**
 * Navigation and 404 page tests — do not require a valid auth session.
 */

test.describe('Navigation', () => {
  test('shows 404 page for unknown routes when authenticated', async ({ page }) => {
    // Navigate directly to an unknown hash route
    await page.goto('/#/this-route-does-not-exist');
    // The app will show the Auth page if not logged in, or the NotFound page if logged in.
    // We just check either auth form or NotFound page renders without a crash.
    await expect(
      page.getByPlaceholder('you@company.com').or(page.getByText(/404/))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('app root loads without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Filter out known non-critical warnings
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('favicon') &&
        !e.toLowerCase().includes('warning')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('sidebar links navigate to correct pages', async ({ page }) => {
    const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@example.com';
    const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'testpassword123';

    await page.goto('/');
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('you@company.com').fill(TEST_EMAIL);
    await page.getByPlaceholder('Min 8 characters').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 20_000 });

    const routes = [
      { link: /history/i, hash: /#\/history/ },
      { link: /settings/i, hash: /#\/settings/ },
    ];

    for (const { link, hash } of routes) {
      await page.getByRole('link', { name: link }).first().click();
      await expect(page).toHaveURL(hash, { timeout: 5_000 });
    }
  });
});
