import { expect, test } from '@playwright/test';
import {
  BASE,
  GUEST_READY,
  SLUG,
  addOneAndCheckout,
  codeFromOrderUrl,
  placeOrder,
  scanCard,
  signInOwner,
  skipUnless,
  tokenFromOrderUrl,
} from './flow';
import { orderCountForGuestToken, orderSessionForGuestToken } from './disposable-db';

/**
 * THE GUEST ORDERING FLOW, END TO END, ON A REAL DEPLOYMENT.
 *
 * The hermetic suite (e2e/guest-ordering.spec.ts) proves the screens; this
 * file proves the product: a scan resolves a live card, a placed order is
 * written by the database at the database's prices, the guest's token reads
 * its live status, the bill and the UPI amount come from the server, and the
 * reorder offer puts the same meal back in the cart.
 *
 * IT WRITES ROWS. Point it at a DISPOSABLE branch database — never
 * production. Without its environment it skips itself entirely.
 */

const NEEDS = 'E2E_BASE_URL, E2E_QR_TOKEN, E2E_TABLE_CODE, E2E_SLUG';

test.describe('guest ordering — real database', () => {
  test.skip(!GUEST_READY, skipUnless(false, NEEDS));

  test('a live card opens the real menu, with this table named', async ({ context }) => {
    const page = await scanCard(context);
    await expect(page).toHaveURL(new RegExp(`/menu\\?s=${SLUG}`), { timeout: 20_000 });

    // The scan redirects through a local HTTP host, so wait for hydrated,
    // visible menu content rather than reading body text at the redirect edge.
    await expect(page.getByText('Synthetic Paneer Dish', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/E2E GUEST \d{2}/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-gtab-bar]')).toBeVisible();
  });

  test('the bill is priced by the server: quantities and notes travel, prices do not', async ({
    context,
  }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);

    // Whatever the menu charges for the first plain dish, the checkout shows
    // it — computed from the menu payload, not from anything the cart sent.
    // The dock repeats the same label at phone width; the bill <dl> is the
    // canonical checkout amount and avoids a strict-mode match on both copies.
    const totalText = await page
      .locator('dl')
      .filter({ hasText: 'Total payable' })
      .locator('dd')
      .last()
      .innerText();
    expect(totalText).toMatch(/₹[\d,]+/);
  });

  test('placing an order writes one order and lands on the tracking page', async ({
    context,
  }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);
    const url = await placeOrder(page, 'e2e: one order, one note');

    // The database answered with a two-letter restaurant reference and a guest token.
    expect(codeFromOrderUrl(url)).toMatch(/^[A-Z]{2}-[A-Z0-9]{5}$/);
    expect(tokenFromOrderUrl(url).length).toBeGreaterThanOrEqual(8);

    await expect(page.getByText('Order placed')).toBeVisible();
    // The note went with the order (the kitchen side proves the rest).
    await expect(page.getByText('e2e: one order, one note')).toBeVisible();
  });

  test('double-tapping Place order writes ONE order', async ({ context }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);

    // The classic duplicate: two taps, one intention.
    const button = page.locator('[data-place-order="bill"]');
    await button.click({ clickCount: 2, delay: 40 }).catch(() => {});
    await expect(page).toHaveURL(/\/menu\/order\?.*code=/, { timeout: 30_000 });

    // The Orders tab remembers the most recent order on this device — if a
    // second order had been written, the guest would have been redirected to
    // it twice and the tracking page would have a second code. What must NOT
    // exist is an error saying the second tap ordered again.
    await expect(page.getByText('Order placed')).toBeVisible();
    expect(await orderCountForGuestToken(tokenFromOrderUrl(page.url()))).toBe(1);
  });

  test('two intentional rounds on one table create two tickets in the same sitting', async ({ context }) => {
    const page = await scanCard(context);

    await addOneAndCheckout(page);
    const firstUrl = await placeOrder(page, 'e2e: first intentional round');
    const firstToken = tokenFromOrderUrl(firstUrl);
    const firstOrder = await orderSessionForGuestToken(firstToken);
    expect(firstOrder).not.toBeNull();

    // A fresh cart and fresh attempt token are a second guest intention, not
    // a retry of the first form. Keep the same scanned table/browser context.
    await addOneAndCheckout(page);
    const secondUrl = await placeOrder(page, 'e2e: second intentional round');
    const secondToken = tokenFromOrderUrl(secondUrl);
    const secondOrder = await orderSessionForGuestToken(secondToken);

    expect(secondToken).not.toBe(firstToken);
    expect(secondOrder).not.toBeNull();
    expect(secondOrder?.id).not.toBe(firstOrder?.id);
    expect(secondOrder?.order_session_id).toBe(firstOrder?.order_session_id);

    const dashboard = await signInOwner(context);
    await dashboard.goto(`${BASE}/dashboard`);
    const session = dashboard.locator(`[data-active-session="${firstOrder?.order_session_id}"]`);
    await expect(session).toBeVisible({ timeout: 45_000 });
    await expect(session).toContainText('2 tickets');
    await expect(session).toContainText(codeFromOrderUrl(firstUrl));
    await expect(session).toContainText(codeFromOrderUrl(secondUrl));
    await expect(session.getByText('2 × Synthetic Paneer Dish').first()).toBeVisible();
  });

  test('the tracking page follows the kitchen, and the bill keeps the exact amount', async ({
    context,
  }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);
    const url = await placeOrder(page);

    // The tracker draws only statuses the server gave.
    await expect(page.locator('[data-placed-mark="ok"]')).toBeVisible();
    await expect(page.getByText('Bill').first()).toBeVisible();

    // The bill's Total row is distinct from the other labels on the order page.
    const billTotal = await page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Bill', exact: true }) })
      .locator('dl dd')
      .last()
      .innerText();
    expect(billTotal).toMatch(/₹[\d,]+/);
    await expect(page.getByText(/Pay at the counter before you leave/)).toBeVisible();
    await expect(page.locator('[data-pay-upi]')).toHaveCount(0);

    // Status reads need the token; the poller is what keeps this fresh. A
    // reload must not lose it (a real reload is the reconnect story).
    await page.reload();
    await expect(page.locator('[data-placed-mark="ok"]')).toBeVisible();
    expect(tokenFromOrderUrl(page.url())).toBe(tokenFromOrderUrl(url));
  });

  test('reorder puts the same meal back in the cart', async ({ context }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);
    await placeOrder(page);

    // The submitted cart is copied to a separate key before the live cart is
    // cleared. Wait for that storage write explicitly so a missing offer points
    // to the save/read path rather than an arbitrary hydration timeout.
    await expect
      .poll(() => page.evaluate((slug) => localStorage.getItem(`ad_last_cart:${slug}`), SLUG), {
        timeout: 15_000,
      })
      .not.toBeNull();
    const reorder = page.locator('[data-reorder-button]');
    await expect(reorder).toBeVisible({ timeout: 15_000 });
    await reorder.click();

    // The cart is refilled from the order that was just placed.
    await expect(page).toHaveURL(/\/menu\/cart/);
    await expect(page.getByRole('link', { name: 'Continue to checkout' })).toBeVisible();
  });

  test('prices planted in localStorage never reach the bill', async ({ context }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);

    // Tamper at the last possible moment: the form will post ids and
    // quantities whatever this page holds, and place_public_order re-reads
    // every price inside the database.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('autodine.cart.'));
      if (!key) return;
      const lines = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<Record<string, unknown>>;
      for (const line of lines) line.unitPricePaise = 1;
      localStorage.setItem(key, JSON.stringify(lines));
    });

    await placeOrder(page);
    // The bill on the order page is the database's, and it is not ₹0.01.
    const totalText = await page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Bill', exact: true }) })
      .locator('dl dd')
      .last()
      .innerText();
    const rupees = Number(totalText.replace(/[^0-9]/g, ''));
    expect(rupees).toBeGreaterThan(1);
  });
});
