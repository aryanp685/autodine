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
 *   PREVIEW_TEST_EMAIL                dedicated synthetic test account
 *                                     on the test project (autodinetest)
 *   PREVIEW_TEST_PASSWORD             its password
 */

/**
 * R2 allowlist, mirrored from scripts/preview/check-preview.mjs (a test
 * asserts the two patterns stay identical): only this project's
 * branch-alias hosts, never the Production alias, never a custom or
 * arbitrary host. The browser must never be pointed — or tricked into
 * sending the bypass header — anywhere else. The rejected value is
 * never echoed into an error.
 */
const PREVIEW_HOST_PATTERN =
  /^new-git-([a-z0-9-]+)-iamjarvis9896-3988s-projects\.vercel\.app$/;

function permittedPreviewBaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('PREVIEW_URL is not a permitted branch Preview alias');
  }
  const match = PREVIEW_HOST_PATTERN.exec(url.hostname);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !match ||
    match[1] === 'main'
  ) {
    throw new Error('PREVIEW_URL is not a permitted branch Preview alias');
  }
  return url.origin;
}

export default defineConfig({
  testDir: './e2e/preview',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: permittedPreviewBaseUrl(process.env.PREVIEW_URL),
    // R1: no traces and no screenshots, ever. Traces record fill-action
    // values and screenshots capture signed-in screens; neither may
    // exist as a downloadable artifact for a suite that types real
    // (dedicated test-account) credentials. Failures are diagnosed from
    // the list reporter output and by re-running locally.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    reducedMotion: 'reduce',
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '',
      'x-vercel-set-bypass-cookie': 'true',
    },
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
  },
});
