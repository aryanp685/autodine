/**
 * Hosted Preview auth-flow checks (see playwright.preview.config.ts).
 *
 * Coverage, mapped to the flows that broke during activation:
 *   1. The edge still refuses anonymous traffic (no bypass headers).
 *   2. Login with the confirmed test account reaches the workspace
 *      dashboard (workspace creation from its signup is visible).
 *   3. A fresh signup lands on the confirmation-pending page, and
 *      signing in before confirming is refused generically — the exact
 *      surface that hid the Brevo 525 failure. Delivery itself is NOT
 *      asserted here: only an inbox proves delivery.
 *   4. Password-reset request shows the anti-enumeration notice, and a
 *      bogus recovery callback fails safely on the forgot-password page.
 *   5. A bogus signup-confirmation callback lands on the pending page
 *      with its problem notice, not a crash.
 *   6. Staff invitation creation shows a shareable /join link (the link
 *      path works whether or not email delivery is connected).
 *
 * Throwaway addresses use the reserved example.test domain: Supabase
 * treats them as ordinary addresses, nobody real can receive mail for
 * them, and no personal data is involved. The only real account used is
 * the operator-supplied confirmed test account on autodinetest.
 */
import { expect, test } from '@playwright/test';

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '';
const testEmail = process.env.PREVIEW_TEST_EMAIL ?? '';
const testPassword = process.env.PREVIEW_TEST_PASSWORD ?? '';

const configured = Boolean(process.env.PREVIEW_URL && bypass);
const accountConfigured = Boolean(configured && testEmail && testPassword);

function throwaway(label: string): string {
  return `preview-${label}-${Date.now()}@example.test`;
}

test.describe('hosted preview auth flows', () => {
  test.beforeEach(() => {
    test.skip(!configured, 'PREVIEW_URL and VERCEL_AUTOMATION_BYPASS_SECRET are required');
  });

  test('edge refuses anonymous traffic without bypass headers', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ extraHTTPHeaders: {} });
    try {
      const response = await anon.get('/login', { maxRedirects: 0 }).catch(() => null);
      expect(response, 'anonymous request should be answered by the edge').not.toBeNull();
      expect([301, 302, 303, 307, 308, 401, 403]).toContain(response!.status());
      expect(response!.headers()['location'] ?? '').toContain('vercel.com');
    } finally {
      await anon.dispose();
    }
  });

  test('login reaches the workspace dashboard', async ({ page }) => {
    test.skip(!accountConfigured, 'PREVIEW_TEST_EMAIL/PASSWORD are required');
    await page.goto('/login');
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('signup lands on confirmation-pending; unconfirmed sign-in is refused', async ({ page }) => {
    const email = throwaway('signup');
    await page.goto('/signup');
    await page.fill('input[name="fullName"]', 'Preview Check');
    await page.fill('input[name="restaurantName"]', `Preview Check ${Date.now()}`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'Preview-Check-Password9!');
    await page.check('input[name="agree"]');
    await page.getByRole('button', { name: /create|sign up|get started/i }).click();
    await expect(page).toHaveURL(/\/signup\/confirmation-pending/);

    await page.goto('/login');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'Preview-Check-Password9!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('body')).toContainText(/incorrect|confirm/i);
  });

  test('password reset request is anti-enumeration; bogus recovery callback fails safely', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.fill('input[name="email"]', throwaway('reset'));
    await page.getByRole('button', { name: /reset|send/i }).click();
    await expect(page.locator('body')).toContainText(/If that email has an AutoDine account/i);

    await page.goto('/auth/confirm?flow=recovery&code=preview-bogus-code');
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.locator('body')).toContainText(/not opened in the browser|did not work|Request a new/i);
  });

  test('bogus signup confirmation callback lands on pending with a problem notice', async ({ page }) => {
    await page.goto('/auth/confirm?flow=signup&code=preview-bogus-code');
    await expect(page).toHaveURL(/\/signup\/confirmation-pending/);
    await expect(page.locator('body')).toContainText(/could not be completed/i);
  });

  test('staff invitation creates a shareable join link', async ({ page }) => {
    test.skip(!accountConfigured, 'PREVIEW_TEST_EMAIL/PASSWORD are required');
    await page.goto('/login');
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/settings');
    const invitePanel = page.locator('text=Invite someone').first();
    await expect(invitePanel).toBeVisible();
    await page.fill('input[name="email"]', throwaway('invite'));
    await page.getByRole('button', { name: /create invitation link/i }).click();
    await expect(page.locator('body')).toContainText(/\/join\//);
  });
});
