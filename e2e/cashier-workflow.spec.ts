import { expect, test } from '@playwright/test';
import { waitForAppReady } from './flow-helpers';

/**
 * THE COUNTER (CASHIER), IN A BROWSER.
 *
 * The sample queue (lib/demo-data.ts counterQueue) is the fixture: three
 * tickets, ₹1,247 / ₹737 / ₹2,180 owed at the counter. Settling in demo mode
 * is deliberately honest — the row leaves the queue and the screen says
 * "Nothing was recorded and no money changed hands" — so every assertion here
 * is about the controls, the amounts and the guards, not about money moving.
 *
 * WHAT LIVES IN e2e/integration/cashier-flow.spec.ts INSTEAD
 *
 * Real bill generation from an order id, database-calculated amounts, staff-
 * recorded counter payments (including UPI), and the idempotent duplicate-
 * payment guard. Those need a deployment; they skip themselves without one.
 */

test.describe('the queue and the bill', () => {
  test('every waiting ticket is listed with its table and money owed', async ({ page }) => {
    await page.goto('/cashier');
    await waitForAppReady(page);

    for (const [code, table, amount] of [
      ['A-1041', 'T3', '₹1,247'],
      ['A-1038', 'T9', '₹737'],
      ['A-1036', 'T2', '₹2,180'],
    ] as const) {
      await expect(page.getByRole('button', { name: `Select ${code} at ${table}, ${amount} outstanding` })).toBeVisible();
    }

    // The till's own sum, over the whole queue.
    await expect(page.getByText('₹4,164 outstanding')).toBeVisible();
  });

  test('selecting a ticket shows its bill: items, and the exact amount outstanding', async ({
    page,
  }) => {
    await page.goto('/cashier');
    await waitForAppReady(page);

    await page.getByRole('button', { name: 'Select A-1038 at T9, ₹737 outstanding' }).click();

    const panel = page.locator('[aria-labelledby="cashier-order-title"]');
    await expect(panel).toContainText('A-1038');
    await expect(panel).toContainText('1 × Subz Dum Biryani · 2 × Rasmalai');
    await expect(panel).toContainText('Outstanding');
    await expect(panel).toContainText('₹737');
  });

  test('a Collect link from the ledger opens that exact ticket', async ({ page }) => {
    await page.goto('/cashier?order=A-1036');
    await waitForAppReady(page);

    const panel = page.locator('[aria-labelledby="cashier-order-title"]');
    await expect(panel).toContainText('A-1036');
    await expect(panel).toContainText('6 items · 1 × Tandoori Chicken (Full)');
    await expect(panel).toContainText('₹2,180');
  });
});

test.describe('counter payments', () => {
  test('the settle button names the method and the exact amount', async ({ page }) => {
    await page.goto('/cashier');
    await waitForAppReady(page);
    await page.getByRole('button', { name: 'Select A-1041 at T3, ₹1,247 outstanding' }).click();

    const method = page.getByRole('group', { name: 'Payment method' });
    await expect(page.locator('[data-counter-cta]')).toHaveText('Record cash ₹1,247');

    await method.getByRole('button', { name: 'UPI' }).click();
    await expect(page.locator('[data-counter-cta]')).toHaveText('Record UPI ₹1,247');

    await method.getByRole('button', { name: 'Card' }).click();
    await expect(page.locator('[data-counter-cta]')).toHaveText('Record CARD ₹1,247');

    await method.getByRole('button', { name: 'Cash' }).click();
    await expect(page.locator('[data-counter-cta]')).toHaveText('Record cash ₹1,247');
  });

  test('recording a payment clears the ticket and says exactly what happened', async ({
    page,
  }) => {
    await page.goto('/cashier');
    await waitForAppReady(page);

    await page.getByRole('button', { name: 'Select A-1041 at T3, ₹1,247 outstanding' }).click();
    await page.locator('[data-counter-cta]').click();

    // The row is gone at once — money in hand must not be collectible twice.
    await expect(
      page.getByRole('button', { name: 'Select A-1041 at T3, ₹1,247 outstanding' }),
    ).toHaveCount(0);

    // And the screen does not pretend a payment happened: this preview
    // recorded nothing.
    const recorded = page.getByRole('status').filter({ hasText: 'marked paid in this preview' });
    await expect(recorded).toContainText(
      'A-1041 marked paid in this preview. Nothing was recorded and no money changed hands.',
    );
  });

  test('a settled ticket cannot be settled again — one payment, one notice', async ({
    page,
  }) => {
    await page.goto('/cashier');
    await waitForAppReady(page);

    await page.getByRole('button', { name: 'Select A-1041 at T3, ₹1,247 outstanding' }).click();
    await page.locator('[data-counter-cta]').click();
    await expect(
      page.getByRole('button', { name: 'Select A-1041 at T3, ₹1,247 outstanding' }),
    ).toHaveCount(0);

    // The panel has fallen to the next ticket — a different amount — and the
    // queue has one fewer row. There is no path back to A-1041's money.
    await expect(page.locator('[aria-labelledby="cashier-order-title"]')).toContainText('A-1038');
    await expect(page.locator('[data-counter-cta]')).toHaveText('Record cash ₹737');
    await expect(
      page.getByRole('button', { name: /Select A-1041/ }),
    ).toHaveCount(0);
  });

  test('the sample queue resets, and the reset says nothing was real', async ({ page }) => {
    await page.goto('/cashier');
    await waitForAppReady(page);

    await page.locator('[data-counter-cta]').click(); // settles A-1041
    await expect(page.getByRole('button', { name: /Select A-1041/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Reset demo queue' }).click();

    await expect(
      page.getByRole('button', { name: 'Select A-1041 at T3, ₹1,247 outstanding' }),
    ).toBeVisible();
    await expect(page.getByText('Demo queue reset. No real payments were recorded.')).toBeVisible();
  });
});

test.describe('cancellation at the counter', () => {
  test('cancel names the ticket it is about to cancel, and "Keep it" backs out', async ({
    page,
  }) => {
    await page.goto('/cashier');
    await waitForAppReady(page);
    await page.getByRole('button', { name: 'Select A-1041 at T3, ₹1,247 outstanding' }).click();

    await page.getByRole('button', { name: 'Cancel this order' }).click();

    // Two taps, and the question names the order and the table — at a busy
    // counter that naming is the difference between cancelling A-1041 and
    // throwing away the wrong guest's dinner.
    const confirm = page.getByRole('group', { name: 'Confirm cancellation' });
    await expect(confirm).toContainText('Cancel A-1041 for T3?');
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    await expect(
      page.getByRole('button', { name: 'Select A-1041 at T3, ₹1,247 outstanding' }),
    ).toBeVisible();

    // And confirming removes it — after which its money cannot be taken.
    await page.getByRole('button', { name: 'Cancel this order' }).click();
    await page.getByRole('group', { name: 'Confirm cancellation' }).getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByRole('button', { name: /Select A-1041/ })).toHaveCount(0);
    await expect(page.locator('[data-counter-cta]')).not.toHaveText(/A-1041/);
    await expect(page.getByText('A-1041 cancelled in this preview. Nothing was recorded.')).toBeVisible();
  });
});
