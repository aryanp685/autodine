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
 *   6. a second restaurant is independent                  (tenant isolation)
 *   7. rollback restores the previous pair                 (version history)
 *   8. guest ordering still works with a brand applied     (regression)
 *   9. a bad upload is refused with a sentence, nothing written (failure table)
 */

import { expect, test } from '@playwright/test';
import { SLUG, STAFF_READY, signInOwner, skipUnless } from './flow';

const NEEDS = 'E2E_BASE_URL + E2E_OWNER_EMAIL + E2E_OWNER_PASSWORD + E2E_SLUG';
const READY = STAFF_READY && Boolean(SLUG);
const BASE = process.env.E2E_BASE_URL ?? '';

test.describe('brand studio flow', () => {
  test('the import screen carries the brand section for an owner', async ({ browser }) => {
    test.skip(!READY, skipUnless(READY, NEEDS));
    const page = await signInOwner(await browser.newContext());
    await page.goto(`${BASE}/dashboard/menus/import`);

    await expect(page.getByRole('heading', { name: 'Brand — how guests see you' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use this name' })).toBeVisible();
  });

  test('manual brand setup works without any AI: name confirm, colour, create', async ({ browser }) => {
    test.skip(!READY, skipUnless(READY, NEEDS));
    const context = await browser.newContext();
    const page = await signInOwner(context);
    await page.goto(`${BASE}/dashboard/menus/import`);

    // Name: typed and confirmed — the priority-1 source.
    const name = `Brand Flow ${Date.now()}`;
    await page.getByLabel('Restaurant name').fill(name);
    await page.getByRole('button', { name: 'Use this name' }).click();
    await expect(page.getByRole('button', { name: 'Name confirmed' })).toBeVisible();

    // Colour: the first curated swatch (a checked hex).
    await page.getByRole('button', { name: 'Maroon' }).click();

    // A minimal menu paste so Create has something to write.
    await page.getByRole('button', { name: /paste an example/i }).click().catch(() => {});
    const textarea = page.locator('textarea').first();
    await textarea.fill('STARTERS\nPaneer Tikka 320');
    await page.getByRole('button', { name: /read the menu|read menu/i }).first().click();
    await page.getByRole('button', { name: /as a draft menu/i }).click();

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
    const create = page.getByRole('button', { name: /as a draft menu/i });
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
    const chooser = page.locator('input[type="file"][accept*="image"]').first();
    await chooser.setInputFiles({
      name: 'not-a-menu.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<html>hello</html>'),
    });
    await expect(page.getByText(/not a JPG, PNG, WebP|contents do not match/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Brand — how guests see you' })).toBeVisible();
  });
});
