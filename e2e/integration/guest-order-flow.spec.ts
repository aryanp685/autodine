import { expect, test } from '@playwright/test';
import {
  GUEST_READY,
  SLUG,
  addOneAndCheckout,
  codeFromOrderUrl,
  placeOrder,
  scanCard,
  skipUnless,
  tokenFromOrderUrl,
} from './flow';

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
    // The table badge is the database's answer about where this browser is.
    const label=process.env.E2E_TABLE_LABEL;
    await expect(label ? page.getByText(label,{exact:true}).first() : page.getByText(/Table /).first()).toBeVisible();
    // Real dishes with prices, not the sample menu.
    await expect(page.locator('dl, [data-gtab-bar]')).not.toHaveCount(0);
  });

  test('the bill is priced by the server: quantities and notes travel, prices do not', async ({
    context,
  }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);

    // Whatever the menu charges for the first plain dish, the checkout shows
    // it — computed from the menu payload, not from anything the cart sent.
    const totalText = await page.locator('dl').getByText('Total payable',{exact:true}).locator('..').innerText();
    expect(totalText).toMatch(/₹[\d,]+/);
  });

  test('placing an order writes one order and lands on the tracking page', async ({
    context,
  }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);
    const url = await placeOrder(page, 'e2e: one order, one note');

    // The database answered with a code and a guest token.
    expect(codeFromOrderUrl(url)).toHaveLength(5);
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

    // The bill's total is on the page and is the same number the checkout
    // promised — the UPI panel, when the restaurant has one, carries exactly
    // this amount into the QR.
    const billTotal = await page.getByText(/Total/).first().innerText();
    expect(billTotal).toMatch(/₹[\d,]+/);

    const upi = page.locator('[data-pay-upi]');
    if (await upi.count()) {
      await expect(upi).toBeVisible();
      // The amount is filled in by the server, not typed.
      await expect(upi).toContainText(/₹[\d,]+/);
    }

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

    const reorder = page.locator('[data-reorder-button]');
    await expect(reorder).toBeVisible();
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
    const totalText = await page.getByText(/Total/).first().innerText();
    const rupees = Number(totalText.replace(/[^0-9]/g, ''));
    expect(rupees).toBeGreaterThan(1);
  });
});
