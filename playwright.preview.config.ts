import { defineConfig, devices } from '@playwright/test';

/**
 * Hosted Preview checks — a separate config on purpose.
 *
 * The main `playwright.config.ts` boots a local server in demo mode. This
 * one drives a REAL protected Preview deployment (autodinetest data), so
 * it must never be picked up by the hermetic suite: it has its own
 * testDir, no webServer, and every test skips unless the operator
 * environment provides the configuration below.
 *
 * HOW IT GETS PAST DEPLOYMENT PROTECTION (the permanent workflow)
 *
 * Vercel Authentication stays ON. Automation uses the project's
 * Protection Bypass for Automation secret, exactly as Vercel documents
 * for Playwright: the secret travels as a header (never in a URL), and
 * `x-vercel-set-bypass-cookie` turns it into a session cookie so
 * multi-page flows (Supabase Auth redirects, emailed-link callbacks)
 * stay authorized. No Vercel collaborator seats are consumed — on the
 * Hobby plan only one external user could ever be granted anyway.
 *
 * Required environment (never commit values):
 *   PREVIEW_URL                       branch-alias URL of the Preview
 *   VERCEL_AUTOMATION_BYPASS_SECRET   project bypass secret
 *   PREVIEW_TEST_EMAIL                confirmed throwaway owner account
 *                                     on the test project (autodinetest)
 *   PREVIEW_TEST_PASSWORD             its password
 */
export default defineConfig({
  testDir: './e2e/preview',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PREVIEW_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '',
      'x-vercel-set-bypass-cookie': 'true',
    },
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
  },
});
