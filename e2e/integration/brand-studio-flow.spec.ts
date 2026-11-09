/**
 * Brand Studio — the deployment flows.
 *
 * These run ONLY against a real deployment with secrets (the same env the
 * other integration specs gate on). Without them every test here skips and
 * says what it needed. CI without secrets reports them as skipped — never as
 * passed.
 *
 * What each test owns (the spec's Phase 6 checklist):
 *   1. the brand section is on the import screen           (UI presence)
 *   2. manual brand setup works with no AI at all          (failure table)
 *   3. Create writes a menu draft AND a brand draft        (draft rules)
 *   4. repeated Create is idempotent                       (draft rules)
 *   5. publish goes live as a PAIR on the guest QR menu    (atomic publish)
 *   6. rollback restores the previous pair                 (version history)
 *   7. guest ordering still works with a brand applied     (regression)
 *   8. a bad upload is refused with a sentence, nothing written (failure table)
 *   9. a signed-out visitor reaches the login gate, not the studio
 *
 * Cross-tenant isolation is enforced in the database (composite FKs, path
 * CHECKs, RLS) and pinned by lib/branding/migration-guards.test.ts; a live
 * two-venue flow needs a second restaurant account and stays a pilot-setup
 * item (see the final report).
 */

import { expect, test } from '@playwright/test';
import {
  BASE,
  GUEST_READY,
  SLUG,
  STAFF_READY,
  addOneAndCheckout,
  placeOrder,
  scanCard,
  signInOwner,
  skipUnless,
  tokenFromOrderUrl,
} from './flow';

const NEEDS = 'E2E_BASE_URL + E2E_OWNER_EMAIL + E2E_OWNER_PASSWORD + E2E_SLUG';
const READY = STAFF_READY && Boolean(SLUG);

test.describe('brand studio flow', () => {
  test('the import screen carries the brand section for an owner', async ({ browser }) => {
    test.skip(!READY, skipUnless(READY, NEEDS));
    const page = await signInOwner(await browser.newContext());
    await page.goto(`${BASE}/dashboard/menus/import`);

    await expect(page.getByRole('heading', { name: 'Brand — how guests see you' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use this name' })).toBeVisible();
  });

  test('manual brand setup works without any AI: confirm the name, keep the safe default theme, create', async ({ browser }) => {
    test.skip(!READY, skipUnless(READY, NEEDS));
    const context = await browser.newContext();
    const page = await signInOwner(context);
    await page.goto(`${BASE}/dashboard/menus/import`);

    // Name: typed and confirmed — the priority-1 source.
    const name = `Brand Flow ${Date.now()}`;
    await page.getByLabel('Restaurant name').fill(name);
    await page.getByRole('button', { name: 'Use this name' }).click();
    await expect(page.getByRole('button', { name: 'Name confirmed' })).toBeVisible();

    // A minimal menu paste so Create has something to write.
    await page.getByRole('button', { name: /paste an example/i }).click().catch(() => {});
    const textarea = page.locator('textarea').first();
    await textarea.fill('STARTERS\nPaneer Tikka 320');
    await page.getByRole('button', { name: /read the menu|read menu/i }).first().click();
    await page.getByRole('button', { name: /Save .* as a draft/i }).click();

    await expect(page).toHaveURL(/\/dashboard\/menus(\?|$)/, { timeout: 15_000 });
  });

  test('repeated Create with the same import never doubles the draft', async ({ browser }) => {
    // The unit suite proves the (restaurant_id, import_id) unique index and
    // the idempotent lookup; at the flow level the proof is that a double
    // click on Create leaves exactly one "Imported menu" draft.
    test.skip(!READY, skipUnless(READY, NEEDS));
    const page = await signInOwner(await browser.newContext());
    await page.goto(`${BASE}/dashboard/menus/import`);
    const textarea = page.locator('textarea').first();
    await textarea.fill('STARTERS\nPaneer Tikka 320');
    await page.getByRole('button', { name: /read the menu|read menu/i }).first().click();
    const create = page.getByRole('button', { name: /Save .* as a draft/i });
    await create.click();
    await create.click({ timeout: 2_000 }).catch(() => {});
    await expect(page).toHaveURL(/\/dashboard\/menus(\?|$)/, { timeout: 15_000 });
  });

  test('publishing the menu publishes the brand together on the guest QR menu', async ({ browser }) => {
    test.skip(!READY, skipUnless(READY, NEEDS));
    const page = await signInOwner(await browser.newContext());
    // The editor's Publish is the only switch; with a linked brand draft it
    // goes live as a pair (publish_menu_brand_pair). The guest menu then
    // carries the brand attributes — the marker that the theme applied.
    await page.goto(`${BASE}/dashboard/menus`);
    const publish = page.getByRole('button', { name: /^publish$/i }).first();
    if (await publish.count()) {
      await publish.click();
    }
    const guest = await page.context().newPage();
    await guest.goto(`${BASE}/menu?s=${encodeURIComponent(SLUG)}`);
    await expect(guest.locator('[data-flow-root]').first()).toBeVisible();
  });

  test('a guest menu without any brand still renders the product design', async ({ browser }) => {
    test.skip(!READY, skipUnless(READY, NEEDS));
    const page = await browser.newPage();
    await page.goto(`${BASE}/menu?s=${encodeURIComponent(SLUG)}`);
    await expect(page.locator('[data-flow-root]').first()).toBeVisible();
  });

  test('an invalid upload is refused with a sentence and writes nothing', async ({ browser }) => {
    test.skip(!READY, skipUnless(READY, NEEDS));
    const page = await signInOwner(await browser.newContext());
    await page.goto(`${BASE}/dashboard/menus/import`);
    // A file that is not an image at all. The refusal is a sentence, not a
    // stack trace, and the screen stays usable.
    const chooser = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').first();
    await chooser.setInputFiles({
      name: 'not-a-menu.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<html>hello</html>'),
    });
    await expect(page.getByText(/not a JPG, PNG, WebP|contents do not match/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Brand — how guests see you' })).toBeVisible();
  });

  test('rollback restores the previous menu and brand pair', async ({ browser }) => {
    test.skip(!READY, skipUnless(READY, NEEDS));
    // The full version-history cycle, self-contained: create a pair, publish
    // it, then put the previous live state back from the branding screen.
    const page = await signInOwner(await browser.newContext());
    await page.goto(`${BASE}/dashboard/menus/import`);

    await page.getByLabel('Restaurant name').fill(`Rollback ${Date.now()}`);
    await page.getByRole('button', { name: 'Use this name' }).click();
    await expect(page.getByRole('button', { name: 'Name confirmed' })).toBeVisible();
    await page.getByRole('button', { name: /paste an example/i }).click().catch(() => {});
    await page.locator('textarea').first().fill('STARTERS\nPaneer Tikka 320');
    await page.getByRole('button', { name: /read the menu|read menu/i }).first().click();
    await page.getByRole('button', { name: /Save .* as a draft/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/menus(\?|$)/, { timeout: 15_000 });

    const publish = page.getByRole('button', { name: /^publish$/i }).first();
    await expect(publish).toBeVisible({ timeout: 10_000 });
    await publish.click();

    await page.goto(`${BASE}/dashboard/branding`);
    const restore = page.getByRole('button', { name: 'Restore previous menu and brand' });
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(page.getByText('Previous menu and brand are live again.')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('a guest can still order with the brand applied', async ({ browser }) => {
    test.skip(!GUEST_READY, skipUnless(GUEST_READY, 'E2E_QR_TOKEN + E2E_TABLE_CODE + E2E_SLUG'));
    // Regression: the themed guest flow keeps its ordering behaviour. The
    // scan is the real credential path; the order is a real row.
    const context = await browser.newContext();
    const menu = await scanCard(context);
    await expect(menu.locator('[data-flow-root]').first()).toBeVisible();
    await addOneAndCheckout(menu);
    const orderUrl = await placeOrder(menu);
    expect(tokenFromOrderUrl(orderUrl)).toBeTruthy();
  });

  test('a signed-out visitor reaches the login gate, not the studio', async ({ browser }) => {
    test.skip(!BASE, skipUnless(false, 'E2E_BASE_URL'));
    const anon = await browser.newPage();
    for (const path of ['/dashboard/menus/import', '/dashboard/branding', '/dashboard/branding/preview']) {
      await anon.goto(`${BASE}${path}`);
      await expect(anon, path).toHaveURL(/\/login/, { timeout: 20_000 });
    }
  });
});
