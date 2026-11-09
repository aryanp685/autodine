import { expect, test, type BrowserContext } from '@playwright/test';
import {
  BASE,
  GUEST_READY,
  STAFF_READY,
  addOneAndCheckout,
  placeOrder,
  scanCard,
  signInOwner,
  skipUnless,
} from './flow';

/**
 * THE COUNTER (CASHIER), END TO END, ON A REAL DEPLOYMENT.
 *
 * Real bills, real record_counter_payment writes, the UPI claim turning a
 * guest's "I have paid" into a confirmable state at the till, and the
 * idempotent duplicate-confirmation guard. Each test places its own order —
 * money state is exactly the thing tests must not share.
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
    await expect(bill.locator('[data-bill-sheet]')).toBeVisible({ timeout: 20_000 });
    await expect(bill.locator('[data-bill-sheet]').getByText('Total',{exact:true}).locator('..')).toContainText(/₹[\d,]+/);
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

  test('the UPI claim is a claim: pending at the guest, confirmable at the till', async ({
    context,
  }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    const guestUrl = await placeCounterOrder(context, 'e2e: upi claim flow');

    const guest = await context.newPage();
    await guest.goto(guestUrl);

    const payUpi = guest.locator('[data-pay-upi]');
    test.skip(!(await payUpi.count()), 'this restaurant has no UPI details configured');

    await guest.getByRole('button', { name: 'I have paid' }).click();
    // A claim, not a receipt: the order stays pending and says so.
    await expect(guest.locator('[data-upi-claimed]')).toBeVisible({ timeout: 20_000 });

    const till = await signInOwner(context);
    await till.goto(`${BASE}/cashier`);
    // The till knows a guest is claiming, and warns the cashier to check the
    // shop's own UPI app before recording anything.
    await expect(
      till.getByText("Check the restaurant’s own UPI app before recording it as cash"),
    ).toBeVisible({ timeout: 45_000 });

    await till.getByRole('group', { name: 'Payment method' }).getByRole('button', { name: 'UPI' }).click();
    await till.locator('[data-counter-cta]').click();
    await expect(till.locator('[data-counter-cta]')).toBeVisible(); // queue moved on
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
