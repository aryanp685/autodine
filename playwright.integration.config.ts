import { defineConfig, devices } from '@playwright/test';

/**
 * The browser test that needs a REAL database.
 *
 * `playwright.config.ts` is hermetic on purpose: demo mode, no Supabase
 * environment, no secrets in CI. That makes it fast and safe, and it also means
 * it can never produce a genuine `limited` answer from Postgres — the only way
 * to get one in that setup is to type `?v=throttled` into the address bar,
 * which proves nothing.
 *
 * So the throttle is exercised here instead, against an environment you point
 * it at. It is a separate config on purpose:
 *
 *   - it never runs in CI, so `Total: 9 tests` stays true and no secret is
 *     needed by the pipeline;
 *   - it never runs in the deploy path;
 *   - it writes rows (table_session_opens), so it must not be pointed at
 *     production. A branch database restored from a schema dump is the target.
 *
 * HOW TO RUN
 *
 *   E2E_BASE_URL=https://<branch-or-local-host> \
 *   E2E_QR_TOKEN=<a live card on a scan-mode restaurant> \
 *   npx playwright test --config playwright.integration.config.ts --list   # dry run
 *
 *   …then the same without --list, once a browser is installed
 *   (npx playwright install chromium).
 *
 * See docs/scan-throttle-coverage.md for what this proves and what still needs
 * the SQL checks.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './e2e/integration',
  // Sequential: every test spends the same card's budget, and the counting is
  // the thing under test. Parallel workers would race each other's scans.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'throttle',
      testMatch: 'throttle.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  // No webServer: the target is a database-backed environment, which this
  // repository's own `next start` in demo mode is not.
});
