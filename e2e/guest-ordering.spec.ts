import { expect, test } from '@playwright/test';
import { seedCart, waitForAppReady } from './flow-helpers';

/**
 * THE GUEST'S SIDE OF THE TABLE.
 *
 * What a customer with a phone can see and do, against the demo menu the
 * product ships with. Every route is the real one, with the query
 * parameter a QR code would have carried.
 *
 * WHAT LIVES IN e2e/integration/guest-order-flow.spec.ts INSTEAD
 *
 * The half only a database can decide: an order actually written, the
 * bill page of a real order, the item link a live QR card carries (the
 * demo menu deliberately has none -- its rows are divs, because no QR in
 * the wild points at it), and the tracking page of an order that exists.
 * Those run against a disposable branch database and skip themselves
 * here.
 */

test.describe('QR verification and honest problem pages', () => {
  test('a QR token of the wrong shape is refused before anything is looked up', async ({
    page,
  }) => {
    await page.goto('/t/not!a!token');

    await expect(page).toHaveURL(/\/t\/problem\?r=unreadable/);
    await expect(page.getByText('Table access')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This card is not in use' })).toBeVisible();
    await expect(page.getByText('Scan the card standing on your table, or ask staff for one.')).toBeVisible();
  });

  test('a well-shaped token with no live table says ordering is not switched on', async ({
    page,
  }) => {
    await page.goto('/t/thisdoesnotexist7');

    await expect(page).toHaveURL(/\/t\/problem\?r=offline/);
    await expect(page.getByRole('heading', { name: 'Ordering is not switched on' })).toBeVisible();
    await expect(page.getByText('You can still ask at the counter')).toBeVisible();
    await expect(page.getByRole('link', { name: 'AutoDine home' })).toBeVisible();
  });
});

test.describe('menu, variants and prices', () => {
  test('the menu loads with dishes, prices and categories', async ({ page }) => {
    await page.goto('/menu');

    await expect(page.getByText('Saffron & Smoke').first()).toBeVisible();
    await expect(page.getByText('Hara Bhara Kebab').first()).toBeVisible();
    await expect(page.getByText('₹299').first()).toBeVisible();
    await expect(page.getByText('from').first()).toBeVisible();
    const tabs = page.locator('[data-gtab-bar]');
    await expect(tabs.getByRole('link', { name: 'Menu' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Cart' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Orders' })).toBeVisible();
  });

  test('a sold-out dish is named and cannot be added', async ({ page }) => {
    await page.goto('/menu');

    await expect(page.getByText('Sold out').first()).toBeVisible();
    await expect(page.getByText('Laal Maas').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Laal Maas' })).toHaveCount(0);
    await expect(page.locator('a[href*="item=it-laal-maas"]')).toHaveCount(0);
  });

  test('a variant dish is customised in the sheet and priced by the portion chosen', async ({
    page,
  }) => {
    await page.goto('/menu');
    await waitForAppReady(page);
    await page.locator('a[href*="item=it-paneer-tikka"]').first().click();
    await expect(page).toHaveURL(/\/menu\/item\?/);

    // The sheet opens over the menu it came from. Its heading is scoped to
    // the dialog because the page behind it names the same dish.
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Paneer Tikka' })).toBeVisible();
    await expect(sheet.getByText('Sharing · 12 pcs')).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Add to order · ₹349/ })).toBeVisible();

    await sheet.getByText('Sharing · 12 pcs').click();
    await expect(sheet.getByRole('button', { name: /Add to order · ₹629/ })).toBeVisible();

    await sheet.getByRole('button', { name: 'Increase' }).click();
    await expect(sheet.getByRole('button', { name: /Add to order · ₹1,258/ })).toBeVisible();

    await sheet.getByRole('button', { name: /Add to order/ }).click();
    await expect(sheet.getByText('Added to your order ✓')).toBeVisible();
    await expect(page).toHaveURL(/\/menu(\?|$)/);

    await page.goto('/menu/cart');
    await expect(page.getByText('Paneer Tikka').first()).toBeVisible();
    await expect(page.getByText('Sharing · 12 pcs')).toBeVisible();
    await expect(page.getByText('₹629').first()).toBeVisible();
  });

  test('a plain dish adds in one tap and its stepper changes the quantity', async ({ page }) => {
    await page.goto('/menu');
    await waitForAppReady(page);

    await page.getByRole('button', { name: 'Add Hara Bhara Kebab' }).click();
    await expect(page.getByRole('button', { name: 'One more Hara Bhara Kebab' })).toBeVisible();

    await page.getByRole('button', { name: 'One more Hara Bhara Kebab' }).click();
    await expect(page.getByRole('button', { name: 'One fewer Hara Bhara Kebab' })).toBeVisible();
    await page.getByRole('button', { name: 'One fewer Hara Bhara Kebab' }).click();

    await page.goto('/menu/cart');
    await expect(page.getByText('Hara Bhara Kebab').first()).toBeVisible();
    await expect(page.getByText('₹299').first()).toBeVisible();
  });
});

test.describe('cart operations', () => {
  test('the cart changes quantities, removes lines and survives a refresh', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 1 }]);
    await page.goto('/menu/cart');
    await waitForAppReady(page);

    await expect(page.getByText('Hara Bhara Kebab').first()).toBeVisible();
    await page.getByRole('button', { name: 'Increase Hara Bhara Kebab' }).click();
    await expect(page.getByText('₹598').first()).toBeVisible();

    await page.reload();
    await waitForAppReady(page);
    await expect(page.getByText('₹598').first()).toBeVisible();

    await page.getByRole('button', { name: 'Decrease Hara Bhara Kebab' }).click();
    await expect(page.getByText('₹299').first()).toBeVisible();

    await page.getByRole('button', { name: 'Remove Hara Bhara Kebab from your order' }).click();
    await expect(page.getByText('Hara Bhara Kebab')).toHaveCount(0);
    await expect(page.locator('[data-gtab-bar]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Open the menu' })).toBeVisible();
  });
});

test.describe('totals recomputed from the menu', () => {
  test('totals are recomputed from the menu: 2 × ₹299 = ₹598 + 5% tax', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 2 }]);
    await page.goto('/menu/cart');
    await waitForAppReady(page);

    const summary = page.locator('dl');
    await expect(summary.getByText('Subtotal')).toBeVisible();
    await expect(summary.getByText('₹598')).toBeVisible();
    await expect(summary.getByText(/Taxes \(5%\)/)).toBeVisible();
    await expect(summary.getByText('₹30')).toBeVisible();
    // Exact: "Subtotal" also contains "Total", and two matches is a strict-
    // mode failure waiting to happen.
    await expect(summary.getByText('Total', { exact: true })).toBeVisible();
    await expect(summary.getByText('₹628')).toBeVisible();
  });
});

test.describe('special instructions', () => {
  test('a note written at checkout is carried into the order form', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 1 }]);
    await page.goto('/menu/checkout');
    await waitForAppReady(page);

    const note = page.locator('textarea[name="note"]');
    await expect(note).toBeVisible();
    await note.fill('Ring the bell — no onion in the gravy.');
    await expect(note).toHaveValue('Ring the bell — no onion in the gravy.');
    expect((await note.inputValue()).length).toBeLessThanOrEqual(240);

    const form = page.locator('form#co-place-order');
    await expect(form).toHaveCount(1);
  });
});

test.describe('submitting an order', () => {
  test('placing an order fails honestly here, and the cart is never lost', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 1 }]);
    await page.goto('/menu/checkout');
    await waitForAppReady(page);

    await page.locator('[data-place-order]').click();
    await expect(page).toHaveURL(/\/menu\/cart\?error=/);

    await expect(page.getByText('That order was not placed.')).toBeVisible();
    await expect(page.getByText('Ordering is not available right now.')).toBeVisible();
    await expect(page.getByText('Nothing has been charged, and your cart is still here.')).toBeVisible();
    await expect(page.getByText('Hara Bhara Kebab').first()).toBeVisible();
  });

  test('a second tap cannot place a second order: both buttons go busy together', async ({
    page,
  }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 1 }]);
    await page.goto('/menu/checkout');
    await waitForAppReady(page);

    // Hold the submission open so the pending state is observable. Only
    // POSTs to the action are held; prefetches flow past.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/menu\/checkout/, async (route) => {
      // Only the submission is held; prefetches flow past.
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await gate;
      await route.continue();
    });

    await page.locator('[data-place-order]').click();

    // BOTH buttons, not just the one that was tapped. A guest who sees one
    // live button taps it again; a guest who sees none does not.
    const buttons = page.locator('[data-place-order]');
    await expect(buttons.nth(0)).toBeDisabled();
    await expect(buttons.nth(1)).toBeDisabled();
    await expect(buttons.nth(0)).toContainText('Placing your order…');
    await expect(buttons.nth(1)).toContainText('Placing your order…');

    release();
    await page.unrouteAll();
    // Exactly one submission went out, and the honest demo failure is the
    // outcome it reached.
    await expect(page).toHaveURL(/\/menu\/cart\?error=/);
    await expect(page.getByText('That order was not placed.')).toBeVisible();
  });
});

test.describe('tracking, bill and reorder', () => {
  test('an order link without a credential says the order could not be opened', async ({
    page,
  }) => {
    await page.goto('/menu/order?s=demo&code=ABCDE');

    await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the menu' })).toBeVisible();
  });

  test('the Orders tab remembers this phone and says what will appear there', async ({ page }) => {
    await page.goto('/menu/orders');
    await waitForAppReady(page);

    await expect(page.getByRole('heading', { name: 'On this device' })).toBeVisible();
    await expect(page.getByText('Nothing ordered yet')).toBeVisible();
    await expect(page.getByText('Once you order, it will be here with its status')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse the menu' })).toBeVisible();
  });

  test('a bill page without a database says so, with no money at all', async ({ page }) => {
    await page.goto('/bill/00000000-0000-4000-8000-000000000000');

    await expect(page.getByRole('heading', { name: 'Not connected' })).toBeVisible();
    await expect(page.getByText('This deployment has no database configured')).toBeVisible();
    await expect(page.locator('[data-bill]')).toHaveCount(0);
  });
});
