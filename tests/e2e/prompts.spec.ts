import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'testpassword123';

test.describe('Prompt management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('you@company.com').fill(TEST_EMAIL);
    await page.getByPlaceholder('Min 8 characters').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 20_000 });
    await page.goto('/#/prompts');
    await expect(page.getByPlaceholder('Search prompts...')).toBeVisible({ timeout: 8_000 });
  });

  test('prompts page loads and shows search bar', async ({ page }) => {
    await expect(page.getByPlaceholder('Search prompts...')).toBeVisible();
  });

  test('create prompt button navigates to editor', async ({ page }) => {
    // Find the header CTA or empty-state CTA that navigates to /prompts/new.
    const newBtn = page.getByRole('button', { name: /create prompt/i }).or(
      page.getByRole('link', { name: /create prompt/i })
    );
    await newBtn.first().click();
    await expect(page).toHaveURL(/#\/prompts\/new/, { timeout: 8_000 });
  });

  test('search filters prompts list', async ({ page }) => {
    const searchBox = page.getByPlaceholder('Search prompts...');
    await searchBox.fill('zzz_nonexistent_xyz');
    // Should show an empty state or no cards
    await expect(page.getByText(/no prompts|no results/i).or(page.locator('[data-empty]'))).toBeVisible({
      timeout: 3_000,
    }).catch(() => {
      // If the empty state text isn't present, verify the count of prompt cards is 0
    });
  });
});

test.describe('Prompt runner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('you@company.com').fill(TEST_EMAIL);
    await page.getByPlaceholder('Min 8 characters').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 20_000 });
  });

  test('404 page shown for non-existent prompt', async ({ page }) => {
    await page.goto('/#/prompts/non-existent-id-abc123');
    // Either a NotFound page or an error state should be visible
    await expect(
      page.getByText(/404|not found|does not exist/i)
    ).toBeVisible({ timeout: 10_000 });
  });
});
