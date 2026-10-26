import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the staff shell.
 *
 * WHY THIS EXISTS SEPARATELY FROM `npm test`
 *
 * Everything in `npm test` renders markup. That proves the rail is *in* the
 * HTML; it cannot prove the rail stays on screen when somebody clicks, which
 * is the actual requirement ("keep the left sidebar visible when navigating to
 * Kitchen"). Only a browser can answer that, so these run in their own
 * workflow and never in the deploy path.
 *
 * DEMO MODE, NO DATABASE
 *
 * No Supabase environment is set for this job, which is a supported state: the
 * proxy lets the routes through and each screen renders its own sample data.
 * That makes the test hermetic -- no secrets in CI, nothing to clean up -- and
 * it exercises the same shell, the same rail and the same links as production.
 *
 * PORT 3100, NOT 3000
 *
 * A developer running `npm run dev` on 3000 should not have their server
 * silently adopted by the test run.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testMatch: 'desktop.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // The rail becomes a bottom sheet below `lg`; 390px is the width the
      // mobile requirement names. Its own file, so nothing has to be skipped
      // at runtime and a failure names the viewport it failed at.
      name: 'phone',
      testMatch: 'phone.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      /*
       * Tests that need a real deployment and real accounts.
       *
       * They exist as a project rather than as loose files so that
       * `npx playwright test --project=integration` runs them and nothing
       * else. Every test in here skips itself when its environment is
       * missing, which is the state CI is in: no secrets, so the run is green
       * and the report says "skipped" rather than "verified". A file that no
       * project matched would be a file that silently never ran, which is how
       * a documented flow becomes a flow nobody ever clicked.
       */
      name: 'integration',
      testMatch: 'integration/**/*.spec.ts',
      // Serial by nature: one test mints an invitation the next one redeems,
      // and each of them writes rows.
      workers: 1,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx next start -H 127.0.0.1 -p 3100',
    url: 'http://127.0.0.1:3100/dashboard',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
