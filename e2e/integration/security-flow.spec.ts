import { expect, test } from '@playwright/test';
import {
  BASE,
  EXPIRED_QR,
  GUEST_READY,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  STAFF_READY,
  addOneAndCheckout,
  codeFromOrderUrl,
  signInOwner,
  placeOrder,
  scanCard,
  skipUnless,
} from './flow';

/**
 * SECURITY AND FAILURE CASES, END TO END, ON A REAL DEPLOYMENT.
 *
 * The doors this file checks are all decided by the database or the proxy:
 * unauthorised staff access, cross-tenant bill access, expired QR cards, and
 * the duplicate order write being refused by place_public_order. The hermetic
 * suite (e2e/security.spec.ts) covers the browser-side half — tampered carts
 * and honest failure screens.
 *
 * IT WRITES ROWS. Point it at a DISPOSABLE branch database only.
 */

const NEEDS = 'E2E_BASE_URL (+ E2E_OWNER_* for staff doors, + guest env for the order doors)';

test.describe('security — real database', () => {
  test.skip(!(BASE && (STAFF_READY || GUEST_READY)), skipUnless(false, NEEDS));

  test('every staff door sends a signed-out visitor to the login page', async ({ context }) => {
    const anon = await context.newPage();
    for (const path of [
      '/kitchen',
      '/cashier',
      '/dashboard',
      '/dashboard/orders',
      '/bill/00000000-0000-4000-8000-000000000000',
    ]) {
      await anon.goto(`${BASE}${path}`);
      await expect(anon, path).toHaveURL(/\/login/, { timeout: 20_000 });
    }
  });

  test('a wrong password says no, and shows no shell', async ({ context }) => {
    test.skip(!STAFF_READY, skipUnless(false, 'E2E_OWNER_EMAIL (for the account name)'));
    const page = await context.newPage();
    await page.goto(`${BASE}/login`);
    await page.getByLabel('Work email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.locator('#app-rail')).toHaveCount(0, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('a bill belonging to another restaurant answers "not found", never the bill', async ({
    context,
  }) => {
    const otherOrderId = process.env.E2E_OTHER_ORDER_ID ?? '';
    test.skip(!otherOrderId || !STAFF_READY, skipUnless(false, 'E2E_OTHER_ORDER_ID (a uuid from a DIFFERENT restaurant on the branch db)'));
    test.skip(!STAFF_READY, skipUnless(false, 'owner sign-in'));

    const till = await context.newPage();
    await till.goto(`${BASE}/login`);
    await till.getByLabel('Work email').fill(OWNER_EMAIL);
    await till.getByLabel('Password').fill(OWNER_PASSWORD);
    await till.getByRole('button', { name: 'Sign in' }).click();
    await expect(till.locator('#app-rail')).toBeVisible({ timeout: 20_000 });

    await till.goto(`${BASE}/bill/${otherOrderId}`);
    // "That order does not exist, or it belongs to a different restaurant."
    // The answer never confirms an order exists somewhere else.
    await expect(till.getByRole('heading', { name: 'Bill not found' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(till.locator('[data-bill-sheet]')).toHaveCount(0);
  });

  test('an expired card is refused with words, not with a menu', async ({ context }) => {
    test.skip(!EXPIRED_QR, skipUnless(false, 'E2E_EXPIRED_QR_TOKEN (a card aged past expiry on the branch db)'));
    const page = await scanCard(context, EXPIRED_QR);
    await expect(page).toHaveURL(/\/t\/problem\?r=/, { timeout: 20_000 });
    await expect(page.getByText('Table access')).toBeVisible();
  });

  test('a tampered cart prices at the menu when the order is written', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env'));
    const page = await scanCard(context);
    await addOneAndCheckout(page);

    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('autodine.cart.'));
      if (!key) return;
      const lines = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<Record<string, unknown>>;
      for (const line of lines) {
        line.qty = 1;
        line.unitPricePaise = 1;
        line.pricePaise = 1;
      }
      localStorage.setItem(key, JSON.stringify(lines));
    });

    const url = await placeOrder(page);
    await expect(page.getByText('Bill').first()).toBeVisible();

    // The bill totals come from the database's price snapshots. A one-paisa
    // line would show a one-rupee-or-less bill; real menu prices never do.
    const totals = await page.locator('dl').getByText('Total',{exact:true}).locator('..').innerText();
    expect(Number(totals.replace(/[^0-9]/g, ''))).toBeGreaterThan(9);
    expect(url).toContain('code=');
  });

  test('duplicate submission writes one order, not two', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env'));
    const page = await scanCard(context);
    await addOneAndCheckout(page);

    const note = `e2e: duplicate submission ${Date.now()}`;
    await page.locator('textarea[name="note"]').fill(note);
    await page.locator('[data-place-order="bill"]').click({ clickCount: 2, delay: 40 });
    await expect(page).toHaveURL(/\/menu\/order\?.*code=/, { timeout: 30_000 });
    const code = codeFromOrderUrl(page.url());
    expect(code).toBeTruthy();
    await expect(page.locator('[aria-label="Order reference"]')).toContainText(code);

    // The confirmation flow deliberately has no Orders tab. Inspect the real
    // staff board instead: count orders carrying this unique submission note,
    // not buttons on a guest page (which cannot prove database uniqueness).
    const board = await signInOwner(context);
    await board.goto(`${BASE}/kitchen`);
    const matches = board.locator('article[data-state]', {hasText:note});
    await expect(matches).toHaveCount(1, {timeout:20_000});
    await expect(matches).toContainText(code);
    await board.reload();
    await expect(matches).toHaveCount(1, {timeout:20_000});
  });
});
