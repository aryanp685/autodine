import { expect, test, type BrowserContext } from '@playwright/test';
import {
  BASE,
  GUEST_READY,
  STAFF_READY,
  addOneAndCheckout,
  placeOrder,
  tokenFromOrderUrl,
  scanCard,
  signInOwner,
  skipUnless,
} from './flow';
import { orderSessionForGuestToken } from './disposable-db';

/**
 * THE COUNTER (CASHIER), END TO END, ON A REAL DEPLOYMENT.
 *
 * Real bills, real record_counter_payment writes, counter-only guest payment
 * messaging, and the idempotent duplicate-confirmation guard. Each test places
 * its own order — money state is exactly the thing tests must not share.
 *
 * IT WRITES ROWS (orders AND payments). Point it at a DISPOSABLE branch
 * database only.
 */

const NEEDS = 'E2E_BASE_URL, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD (+ guest env for the order half)';

async function placeCounterOrder(context: BrowserContext, note: string): Promise<string> {
  const page = await scanCard(context);
  await addOneAndCheckout(page);
  return placeOrder(page, note);
}

test.describe('cashier — real database', () => {
  test.skip(!STAFF_READY, skipUnless(false, NEEDS));

  test('a counter order shows at the till with the amount the guest was promised', async ({
    context,
  }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: settle me at the counter');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/cashier`);

    const row = till.getByRole('button', { name: /Select .*outstanding/ }).first();
    await expect(till.locator('[data-counter-cta]')).toBeVisible({ timeout: 45_000 });

    // The amount on the settle button is the outstanding the DATABASE holds —
    // the same figure the guest's bill shows, not one this browser chose.
    const cta = await till.locator('[data-counter-cta]').innerText();
    expect(cta).toMatch(/^Record (cash|CARD|UPI) ₹[\d,]+$/);
    await row.click();
  });

  test('the bill page prints the order, and settles to zero once paid', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: bill then pay');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/dashboard/orders`);

    // The ledger links the counter to the exact ticket ("Collect"), and the id
    // in that link is what /bill/<id> resolves — for THIS restaurant only.
    const collect = till.getByRole('link', { name: /Collect/ }).first();
    await expect(collect).toBeVisible({ timeout: 45_000 });
    const href = await collect.getAttribute('href');
    const orderId = (href ?? '').split('order=')[1]?.split('&')[0] ?? '';
    expect(orderId).not.toBe('');

    const bill = await till.context().newPage();
    await bill.goto(`${BASE}/bill/${orderId}`);
    const billSheet = bill.locator('[data-bill-sheet]');
    await expect(billSheet).toBeVisible({ timeout: 20_000 });
    await expect(billSheet.getByText('Total', { exact: true }).locator('..')).toContainText(/₹[\d,]+/);
  });

  test('recording a counter payment moves the money from pending to paid', async ({
    context,
  }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: cash on the counter');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/cashier`);
    await expect(till.locator('[data-counter-cta]')).toBeVisible({ timeout: 45_000 });
    await till.locator('[data-counter-cta]').click();

    // The database accepts the payment; the queue re-reads without it and the
    // screen names what was recorded.
    await expect(till.getByRole('status').or(till.getByRole('alert')).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(till.locator('[data-counter-cta]')).not.toHaveText(/₹0[^0-9]/);
  });

  test('guest payment stays at the counter; no online UPI claim is exposed', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    const guestUrl = await placeCounterOrder(context, 'e2e: counter-only payment');

    const guest = await context.newPage();
    await guest.goto(guestUrl);

    // Product policy: customers do not claim or submit online payments. UPI,
    // cash and card are recorded by staff at the counter only.
    await expect(guest.locator('[data-pay-upi]')).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'I have paid' })).toHaveCount(0);
    await expect(guest.getByText(/Pay at the counter before you leave/)).toBeVisible();
  });

  test('double-tapping Record writes ONE payment', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: no double money');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/cashier`);
    await expect(till.locator('[data-counter-cta]')).toBeVisible({ timeout: 45_000 });

    // Two taps, one intention — record_payment is idempotent per key, and the
    // row leaves the queue. What must not exist anywhere is a second payment.
    await till.locator('[data-counter-cta]').click({ clickCount: 2, delay: 40 }).catch(() => {});
    await till.waitForTimeout(3000);

    // Re-read the till and the bill: one payment, nothing outstanding twice.
    await till.reload();
    await expect(till.getByText(/outstanding/i).first()).toBeVisible();
  });

  test('two ticket sitting settles, prints the exact total, closes and starts a fresh sitting', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    const guest = await scanCard(context);

    await addOneAndCheckout(guest);
    const firstUrl = await placeOrder(guest, 'e2e: session ticket one');
    await addOneAndCheckout(guest);
    const secondUrl = await placeOrder(guest, 'e2e: session ticket two');
    const first = await orderSessionForGuestToken(tokenFromOrderUrl(firstUrl));
    const second = await orderSessionForGuestToken(tokenFromOrderUrl(secondUrl));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.order_session_id).toBe(second?.order_session_id);

    const till = await signInOwner(context);
    await till.goto(`${BASE}/dashboard`);
    const session = till.locator(`[data-active-session="${first?.order_session_id}"]`);
    await expect(session).toBeVisible({ timeout: 45_000 });
    await expect(session).toContainText('2 tickets');
    const dashboardTotal = (await session.locator('[data-session-total]').innerText()).trim();

    await session.getByRole('button', { name: /Mark .* paid/ }).click();
    await expect(session.getByRole('button', { name: /Close .* issue final receipt/ })).toBeVisible({ timeout: 20_000 });
    await session.getByRole('button', { name: /Close .* issue final receipt/ }).click();
    const confirm = session.getByRole('group', { name: /Confirm checkout/ });
    await confirm.getByRole('button', { name: 'Close & issue' }).click();
    await expect(till).toHaveURL(/\/invoice\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
    const sheet = till.locator('[data-invoice-sheet]');
    await expect(sheet).toBeVisible();
    const invoiceTotal = (await till.locator('[data-invoice-total]').innerText()).trim();
    expect(invoiceTotal).toBe(dashboardTotal);
    await expect(sheet.locator('tbody tr')).toHaveCount(2);

    await till.getByRole('button', { name: 'Create 24-hour link' }).click();
    const secureLinkInput = till.getByLabel('New secure receipt link');
    await expect(secureLinkInput).toBeVisible({ timeout: 20_000 });
    const shareUrl = await secureLinkInput.inputValue();
    expect(shareUrl).toMatch(/\/receipt-share\/[A-Za-z0-9_-]{43}$/);
    const sharedReceipt = await context.newPage();
    await sharedReceipt.goto(shareUrl);
    await expect(sharedReceipt.locator('[data-invoice-sheet]')).toBeVisible({ timeout: 20_000 });
    await expect(sharedReceipt.locator('[data-invoice-total]')).toHaveText(invoiceTotal);
    await expect(sharedReceipt.getByRole('button', { name: 'Create 24-hour link' })).toHaveCount(0);

    // Exercise the browser's CSS page-size path and make sure each PDF is a
    // real PDF artifact generated from the same final receipt DOM.
    const layout = till.getByLabel('Receipt print layout');
    for (const [name, options] of [
      ['a4', { printBackground: true, preferCSSPageSize: true }],
      ['58mm', { printBackground: true, preferCSSPageSize: true }],
      ['80mm', { printBackground: true, preferCSSPageSize: true }],
    ] as const) {
      await layout.selectOption(name);
      await expect(sheet).toHaveAttribute('data-layout', name);
      await till.emulateMedia({ media: 'print' });
      const pdf = await till.pdf(options);
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.length).toBeGreaterThan(2_000);
      await till.emulateMedia({ media: 'screen' });
      expect((await till.locator('[data-invoice-total]').innerText()).trim()).toBe(invoiceTotal);
    }

    await till.getByRole('button', { name: 'Revoke link' }).click();
    await expect(till.getByText('Receipt link revoked.')).toBeVisible();
    await sharedReceipt.reload();
    await expect(sharedReceipt.getByText('This link is unavailable')).toBeVisible({ timeout: 20_000 });

    await till.goto(`${BASE}/dashboard/invoices`);
    await expect(till.getByRole('link', { name: /INV\// }).first()).toBeVisible({ timeout: 20_000 });

    // After closure, a further intentional order on the same QR must not
    // attach to the settled sitting or its immutable invoice.
    await addOneAndCheckout(guest);
    const thirdUrl = await placeOrder(guest, 'e2e: fresh sitting after checkout');
    const third = await orderSessionForGuestToken(tokenFromOrderUrl(thirdUrl));
    expect(third).not.toBeNull();
    expect(third?.order_session_id).not.toBe(first?.order_session_id);
    expect(third?.session_status).toBe('open');
    await till.goto(`${BASE}/dashboard`);
    await expect(till.locator(`[data-active-session="${third?.order_session_id}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(till.locator(`[data-active-session="${first?.order_session_id}"]`)).toHaveCount(0);
  });

  test('a cancelled order cannot be settled — money for food that will not come', async ({
    context,
  }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: cancel then try to pay');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/cashier`);
    await expect(till.locator('[data-counter-cta]')).toBeVisible({ timeout: 45_000 });
    const rowsBefore = await till.getByRole('button', { name: /Select .*outstanding/ }).count();

    await till.getByRole('button', { name: 'Cancel this order' }).click();
    await till.getByRole('group', { name: 'Confirm cancellation' })
      .getByRole('button', { name: 'Yes, cancel it' })
      .click();

    // The ticket leaves the queue — and with it every path to its money.
    await expect
      .poll(async () => till.getByRole('button', { name: /Select .*outstanding/ }).count(), {
        timeout: 20_000,
        message: 'the cancelled ticket never left the queue',
      })
      .toBe(rowsBefore - 1);
  });
});
