import { expect, type BrowserContext, type Page, type Request } from '@playwright/test';

/**
 * Shared plumbing for the integration specs — the ones that click through a
 * REAL deployment with a real database.
 *
 * THE RULES THESE SPECS LIVE UNDER (read before pointing them anywhere)
 *
 *   · They WRITE ROWS: orders, payments, and staff sessions. Run them only
 *     against the disposable local Supabase stack (or another explicitly
 *     approved non-production target). Never production.
 *   · Without their environment variables they skip themselves. A green CI
 *     run with "7 skipped" is this file being discoverable, not verified.
 *   · Every env value is the human's to supply; nothing is guessed and no
 *     fallback pretends to be a real restaurant.
 */

export const BASE = process.env.E2E_BASE_URL ?? '';
/** A dedicated live card reserved for the real throttle integration test. */
export const QR = process.env.E2E_QR_TOKEN ?? '';
/** Fresh per-test cards keep the ordinary guest flows below the card open limit. */
const SCAN_TOKENS = (process.env.E2E_QR_TOKENS ?? '').split(',').map((token) => token.trim()).filter(Boolean);
let scanTokenCursor = 0;
/** The six-digit on-site code for that card's table. */
export const TABLE_CODE = process.env.E2E_TABLE_CODE ?? '';
/** The restaurant slug the card belongs to. */
export const SLUG = process.env.E2E_SLUG ?? '';
/** Owner of the test restaurant (staff screens, cancellations, bills). */
export const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? '';
export const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? '';
/** Optional: a card deliberately aged past expiry on the branch database. */
export const EXPIRED_QR = process.env.E2E_EXPIRED_QR_TOKEN ?? '';

/** The guest half is ready: enough to scan, order and watch. */
export const GUEST_READY = Boolean(BASE && QR && TABLE_CODE && SLUG);
/** The staff half is ready: enough to sign in and run the pass/counter. */
export const STAFF_READY = Boolean(BASE && OWNER_EMAIL && OWNER_PASSWORD);

export function skipUnless(ready: boolean, needs: string): string {
  return `needs a disposable non-production target (${needs}); set the E2E_* environment and run --config playwright.integration.config.ts or --project=integration`;
}

/** Sign an owner in and wait for the staff shell — the proof of a session. */
export async function signInOwner(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Work email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#app-rail')).toBeVisible({ timeout: 20_000 });
  return page;
}

/**
 * Scan the table card. Returns the menu page for the restaurant the card
 * belongs to — with the card-pass cookie the scan handler set.
 */
export async function scanCard(
  context: BrowserContext,
  token?: string,
  onMenuRequest?: (request: Request) => void,
): Promise<Page> {
  const selected = token ?? (SCAN_TOKENS.length
    ? SCAN_TOKENS[scanTokenCursor++ % SCAN_TOKENS.length]
    : QR);
  const page = await context.newPage();
  if (onMenuRequest) {
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/menu' && url.searchParams.get('s') === SLUG) onMenuRequest(request);
    });
  }
  await page.goto(`${BASE}/t/${selected}`);
  return page;
}

/**
 * Put one plain dish on the order and walk to checkout. Returns the checkout
 * page. Adds nothing else: each spec decides its own quantities and notes.
 */
export async function addOneAndCheckout(page: Page): Promise<void> {
  await page.goto(`${BASE}/menu?s=${encodeURIComponent(SLUG)}`);
  const add = page.getByRole('button', { name: /^Add / }).first();
  await add.click();
  await page.locator('[data-gtab-bar]').getByRole('link', { name: 'Cart' }).click();
  await page.getByRole('link', { name: 'Continue to checkout' }).click();
  await expect(page).toHaveURL(/\/menu\/checkout/);
}

/**
 * Place the order currently on the checkout screen.
 *
 * Handles both access states the scan flow can be in: `browse` (card scanned,
 * code not typed — the six-digit form is on the checkout screen itself) and
 * `verified` (code typed already). Returns the order page URL.
 */
export async function placeOrder(page: Page, note?: string): Promise<string> {
  // browse state: the six-digit form is on this screen, above the bill.
  const codeBox = page.locator('input[name="code"], input[inputmode="numeric"]').first();
  if (await codeBox.isVisible().catch(() => false)) {
    await codeBox.fill(TABLE_CODE);
    await page.getByRole('button', { name: /verify|continue|place/i }).first().click();
    await expect(page).toHaveURL(/\/menu\/checkout/, { timeout: 15_000 });
  }

  if (note) await page.locator('textarea[name="note"]').fill(note);
  await page.locator('[data-place-order="bill"]').click();
  await expect(page).toHaveURL(/\/menu\/order\?.*code=/, { timeout: 30_000 });
  return page.url();
}

/** The guest token out of an order URL — the credential for status reads. */
export function tokenFromOrderUrl(url: string): string {
  return new URL(url).searchParams.get('t') ?? '';
}

export function codeFromOrderUrl(url: string): string {
  return new URL(url).searchParams.get('code') ?? '';
}
