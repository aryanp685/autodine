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
 * So the throttle is exercised here instead, against a dedicated local-only
 * runner. It is a separate config on purpose:
 *
 *   - it runs only in the dedicated isolated workflow/local runner, not the
 *     demo-mode E2E job or deploy path;
 *   - it writes rows (table_session_opens), so the supported runner provisions
 *     a disposable local database and synthetic card, never a branch or
 *     production database.
 *
 * HOW TO RUN
 *
 *   npm run test:e2e:throttle
 *
 * This provisions local PostgREST and Next.js around the disposable database.
 * See docs/e2e-local.md for prerequisites and evidence, and
 * docs/scan-throttle-coverage.md for what the tests prove and what still needs
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
    /* See playwright.config.ts: behaviour, not motion. */
    reducedMotion: 'reduce',
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
