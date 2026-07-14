import { test, expect } from '@playwright/test';

/**
 * Auth flow tests.
 * These require a live Supabase project configured via VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
 * Use a dedicated test account: TEST_EMAIL / TEST_PASSWORD env vars.
 */

const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'testpassword123';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows login form on first visit', async ({ page }) => {
    // HashRouter: page loads, redirects to Auth when unauthenticated
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('Min 8 characters')).toBeVisible();
  });

  test('shows validation error for empty form submit', async ({ page }) => {
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /sign in/i }).click();
    // Browser native validation prevents submit; email field gets :invalid state
    const emailInput = page.getByPlaceholder('you@company.com');
    const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(validity).toBe(false);
  });

  test('toggles between login and signup mode', async ({ page }) => {
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible({ timeout: 10_000 });
    // Switch to sign up
    await page.getByRole('button', { name: /sign up/i }).click();
    await expect(page.getByPlaceholder('John Doe')).toBeVisible();
    // Switch back to sign in
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByPlaceholder('John Doe')).not.toBeVisible();
  });

  test('shows error toast on bad credentials', async ({ page }) => {
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('you@company.com').fill('bad@example.com');
    await page.getByPlaceholder('Min 8 characters').fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Supabase returns an error; UI shows toast or inline error message
    await expect(
      page.getByRole('alert').or(page.getByRole('status')).or(page.getByText(/invalid|incorrect|error/i))
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Authenticated user', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in before each test
    await page.goto('/');
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('you@company.com').fill(TEST_EMAIL);
    await page.getByPlaceholder('Min 8 characters').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    // Wait for dashboard to load. HashRouter may keep the root URL as "/" for the dashboard route.
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 20_000 });
  });

  test('lands on dashboard after sign in', async ({ page }) => {
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('navigates to prompts page', async ({ page }) => {
    await page.getByRole('link', { name: /prompts/i }).first().click();
    await expect(page).toHaveURL(/#\/prompts/);
    await expect(page.getByPlaceholder('Search prompts...')).toBeVisible({ timeout: 5_000 });
  });
});
