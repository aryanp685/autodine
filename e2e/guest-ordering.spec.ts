import { expect, test } from '@playwright/test';
import { seedCart } from './flow-helpers';

/**
 * THE GUEST ORDERING FLOW, IN A BROWSER.
 *
 * QR → menu → variants → cart → totals → checkout → order. What runs here is
 * everything the demo deployment can honestly decide: the menu the guest
 * reads, the cart they build, the totals that are recomputed from the menu
 * rather than from the browser's copy of a price, the double-tap guard on
 * Place order, and the honest failure this (database-less) deployment
 * produces instead of a fake success.
 *
 * WHAT LIVES IN e2e/integration/guest-order-flow.spec.ts INSTEAD
 *
 * The steps that a real database decides: a real order being written, its
 * live status, the bill and the UPI amount from public_upi_details, and the
 * reorder offer. Those tests skip themselves without a deployment; nothing
 * here pretends to cover them.
 */

test.describe('QR verification and menu loading', () => {
  test('an unreadable card lands on the honest problem page, not on a menu', async ({ page }) => {
    await page.goto('/t/not!a!token');

    await expect(page).toHaveURL(/\/t\/problem\?r=unreadable/);
    await expect(page.getByText('Table access')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This card is not in use' })).toBeVisible();
    await expect(
      page.getByText('Scan the card standing on your table, or ask staff for one.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'AutoDine home' })).toBeVisible();
  });

  test('a well-formed card with no ordering system says so instead of guessing', async ({
    page,
  }) => {
    // Passes the token shape check (8–128 url-safe chars); this deployment has
    // no database, so the honest answer is "ordering is not switched on".
    await page.goto('/t/AbCdEf123456');

    await expect(page).toHaveURL(/\/t\/problem\?r=offline/);
    await expect(page.getByRole('heading', { name: 'Ordering is not switched on' })).toBeVisible();
    await expect(
      page.getByText('This restaurant has not connected its ordering system. Please order with staff.'),
    ).toBeVisible();
  });

  test('the menu loads with dishes, prices and the three guest tabs', async ({ page }) => {
    await page.goto('/menu');

    await expect(page.getByText('Saffron & Smoke').first()).toBeVisible();
    // A plain dish and its menu price.
    await expect(page.getByText('Hara Bhara Kebab').first()).toBeVisible();
    await expect(page.getByText('₹299').first()).toBeVisible();
    // A dish with portions shows "from" its cheapest price.
    await expect(page.getByText('from').first()).toBeVisible();
    // The guest's three destinations.
    const tabs = page.locator('[data-gtab-bar]');
    await expect(tabs).toHaveCount(1);
    for (const tab of ['Menu', 'Cart', 'Orders']) {
      await expect(tabs.getByRole('link', { name: tab })).toBeVisible();
    }
    // A sold-out dish says so; it does not take orders.
    await expect(page.getByText('Sold out').first()).toBeVisible();
    await expect(page.getByText('Laal Maas').first()).toBeVisible();
  });
});

test.describe('item variants and cart operations', () => {
  test('a variant dish is customised in the sheet and priced by the portion chosen', async ({
    page,
  }) => {
    await page.goto('/menu');

    // The Choose link carries the dish id in its href — scope by href, not by
    // being the nth "Choose" on a long menu.
    await page.locator('a[href*="item=it-paneer-tikka"]').first().click();
    await expect(page).toHaveURL(/\/menu\/item\?/);

    await expect(page.getByRole('heading', { name: 'Paneer Tikka' })).toBeVisible();
    // Default is the first variant (Regular · 6 pcs · ₹349).
    await expect(page.getByRole('button', { name: /Add to order · ₹349/ })).toBeVisible();

    // Choose the other portion; the price follows the variant, not the base.
    await page.getByText('Sharing · 12 pcs').first().click();
    await expect(page.getByRole('button', { name: /Add to order · ₹629/ })).toBeVisible();

    // Quantity in the sheet multiplies the chosen portion's price.
    await page.getByRole('button', { name: 'Increase' }).click();
    await expect(page.getByRole('button', { name: /Add to order · ₹1,258/ })).toBeVisible();
    await page.getByRole('button', { name: 'Decrease' }).click();
    await expect(page.getByRole('button', { name: /Add to order · ₹629/ })).toBeVisible();

    await page.getByRole('button', { name: /Add to order · ₹629/ }).click();
    // The sheet confirms and returns to the menu.
    await expect(page.getByText('Added to your order ✓')).toBeVisible();
    await expect(page).toHaveURL(/\/menu(\?|$)/, { timeout: 10_000 });

    // The cart holds the portion that was chosen.
    await page.goto('/menu/cart');
    await expect(page.getByText('Paneer Tikka')).toBeVisible();
    await expect(page.getByText('Sharing · 12 pcs')).toBeVisible();
    await expect(page.getByText('₹629').first()).toBeVisible();
  });

  test('a plain dish adds in one tap and its stepper changes the quantity', async ({ page }) => {
    await page.goto('/menu');

    await page.getByRole('button', { name: 'Add Hara Bhara Kebab' }).click();
    // The button becomes a stepper showing the quantity.
    await expect(page.getByRole('button', { name: 'One more Hara Bhara Kebab' })).toBeVisible();

    await page.getByRole('button', { name: 'One more Hara Bhara Kebab' }).click();
    await page.getByRole('button', { name: 'One fewer Hara Bhara Kebab' }).click();

    await page.goto('/menu/cart');
    await expect(page.getByText('Hara Bhara Kebab')).toBeVisible();
  });

  test('the cart changes quantities, removes lines and survives a refresh', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 1 }]);
    await page.goto('/menu/cart');

    await expect(page.getByRole('button', { name: 'Increase Hara Bhara Kebab' })).toBeVisible();

    await page.getByRole('button', { name: 'Increase Hara Bhara Kebab' }).click();
    await expect(page.getByText('₹598').first()).toBeVisible();

    await page.getByRole('button', { name: 'Decrease Hara Bhara Kebab' }).click();
    await expect(page.getByText('₹299').first()).toBeVisible();

    // The cart is localStorage: a refresh is the network-interruption story
    // for this screen — whatever happened, the guest's order is still here.
    await page.reload();
    await expect(page.getByText('Hara Bhara Kebab')).toBeVisible();

    await page.getByRole('button', { name: 'Remove Hara Bhara Kebab from your order' }).click();
    await expect(page.getByText('Hara Bhara Kebab')).toHaveCount(0);
  });
});

test.describe('totals and special instructions', () => {
  test('totals are recomputed from the menu: 2 × ₹299 = ₹598 + 5% tax', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 2 }]);
    await page.goto('/menu/cart');

    const summary = page.locator('dl');
    await expect(summary.getByText('Subtotal')).toBeVisible();
    await expect(summary.getByText('₹598')).toBeVisible(); // 2 × menu price 299
    await expect(summary.getByText(/Taxes \(5%\)/)).toBeVisible();
    await expect(summary.getByText('₹30')).toBeVisible(); // 598 × 5% = 29.90 → ₹30
    await expect(summary.getByText('Total')).toBeVisible();
    await expect(summary.getByText('₹628')).toBeVisible(); // 627.90 → ₹628

    // And the checkout screen re-derives the same numbers by itself.
    await page.getByRole('link', { name: 'Continue to checkout' }).click();
    await expect(page).toHaveURL(/\/menu\/checkout/);
    await expect(page.getByText('Subtotal')).toBeVisible();
    await expect(page.getByText('₹598')).toBeVisible();
    await expect(page.getByText(/Taxes \(5%\)/)).toBeVisible();
    await expect(page.getByText('Total payable')).toBeVisible();
    await expect(page.getByText('₹628')).toBeVisible();
  });

  test('special instructions are typed once and carried into the order form', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 1 }]);
    await page.goto('/menu/checkout');

    const note = page.locator('textarea[name="note"]');
    await note.fill('No onion in the raita, less chilli');
    await expect(note).toHaveValue('No onion in the raita, less chilli');

    // The form that will be posted carries the note verbatim.
    const carried = await page.locator('form#co-place-order textarea[name="note"]').inputValue();
    expect(carried).toBe('No onion in the raita, less chilli');
  });
});

test.describe('order submission', () => {
  test('placing an order fails honestly here, and the cart is never lost', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 2 }]);
    await page.goto('/menu/checkout');

    await page.locator('[data-place-order="bill"]').click();

    // This deployment has no database. The action refuses — no fake success —
    // and sends the guest back to the cart with a sentence and their order.
    await expect(page).toHaveURL(/\/menu\/cart\?error=/);
    const alert = page.locator('[data-place-error]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('That order was not placed');
    await expect(alert).toContainText('Ordering is not available right now.');
    await expect(alert).toContainText('Nothing has been charged, and your cart is still here.');
    await expect(page.getByText('Hara Bhara Kebab')).toBeVisible();
  });

  test('a second tap cannot place a second order: both buttons go busy together', async ({
    page,
  }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 1 }]);

    // Hold the submit back so the pending state is observable — the window in
    // which a double tap would write a duplicate order.
    await page.route('**/menu/checkout*', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    await page.goto('/menu/checkout');
    const bill = page.locator('[data-place-order="bill"]');
    const dock = page.locator('[data-place-order="dock"]');
    await bill.click();

    // Both buttons agree that the order is being placed: disabled, busy, and
    // saying so. Two buttons that disagree is how a duplicate gets written.
    await expect(bill).toBeDisabled();
    await expect(dock).toBeDisabled();
    await expect(bill).toContainText('Placing your order…');
    await expect(dock).toContainText('Placing your order…');

    // A second tap during the window does nothing at all (disabled), so one
    // submission is all the server can ever see — and it lands on the honest
    // failure rather than a fabricated receipt.
    await expect(page).toHaveURL(/\/menu\/cart\?error=/);
    await expect(page.locator('[data-place-error]')).toContainText(
      'Ordering is not available right now.',
    );
  });
});

test.describe('order tracking, bill and reorder — honest states without a database', () => {
  test('an order link without a credential says the order could not be opened', async ({
    page,
  }) => {
    await page.goto('/menu/order?s=demo&code=ABCDE');

    await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Order something else' })).toBeVisible();
  });

  test('the Orders tab remembers this phone and says what will appear there', async ({
    page,
  }) => {
    await page.goto('/menu/orders');

    await expect(
      page.getByText('Once you order, it will be here with its status', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Order something else' })).toBeVisible();
  });

  test('a bill page without a database is honest: no fabricated totals', async ({ page }) => {
    await page.goto('/bill/00000000-0000-4000-8000-000000000000');

    await expect(page.getByRole('heading', { name: 'Not connected' })).toBeVisible();
    await expect(
      page.getByText('This deployment has no database configured, so there is no bill to print.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the counter' })).toBeVisible();
    // Nothing money-shaped is drawn from thin air.
    await expect(page.locator('[data-bill]')).toHaveCount(0);
  });
});
