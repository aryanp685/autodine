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
    // Use localhost, not its literal loopback IP: Chromium permits Secure
    // cookies on localhost over the disposable HTTP test server.
    baseURL: 'http://localhost:3100',
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          },
        }
      : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    /* The app draws its entrance and layout animations as springs, and a
     * spring is still moving when Playwright presses the button: the click
     * lands where the button was, not where it is, and the state change the
     * test waits for never comes. The app has a first-class static path
     * (useReducedMotion throughout) -- these tests exercise behaviour, not
     * motion, so they run on it. */
    reducedMotion: 'reduce',
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
       * The guest ordering flow at phone width: QR verification, the menu,
       * variants and the cart, server-priced totals, the double-tap guard on
       * Place order, and the tamper/failure cases — the screens a diner on a
       * phone actually touches. Its own file per area, its own project, so a
       * failure names the width and the workflow it came from.
       */
      name: 'guest',
      testMatch: /(?:guest-ordering|security)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      /*
       * The staff workflows at desk width — the kitchen pass (all four
       * columns on one screen) and the counter (queue + till panel side by
       * side). Both boards are read at a glance and tapped with wet hands;
       * 1280×800 is the wall-tablet/laptop shape they are designed for.
       */
      name: 'staff',
      testMatch: /(?:kitchen-workflow|cashier-workflow)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      /*
       * Tests that need a real Supabase stack and synthetic accounts.
       *
       * `npx playwright test --project=integration` selects these and nothing
       * else. The disposable-supabase-e2e-load workflow provisions Auth,
       * Storage, Realtime and Postgres locally, seeds throwaway fixtures, and
       * runs this project without skips. When someone invokes the hermetic
       * demo suite without E2E variables, individual tests skip themselves;
       * that run is discoverability, never evidence that the database flow
       * passed. A file matched by no project is a file nobody clicked.
       */
      name: 'integration',
      testMatch: 'integration/**/*.spec.ts',
      // Serial by nature: one test mints an invitation the next one redeems,
      // and each of them writes rows.
      workers: 1,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The Brand Studio demo contract: import screen honesty, name
      // confirmation, the real-renderer preview, and the opt-in default.
      name: 'brand',
      testMatch: 'brand-studio.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // The responsive audit: every route × every common viewport, sideways-
      // scroll and landmark assertions, and a screenshot per combination.
      name: 'responsive',
      testMatch: 'responsive.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx next start -H 0.0.0.0 -p 3100',
    url: 'http://localhost:3100/dashboard',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
