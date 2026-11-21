import { expect, test } from '@playwright/test';
import { seedCart, waitForAppReady } from './flow-helpers';

/**
 * FAILURE AND TAMPERING, IN A BROWSER.
 *
 * The guest's localStorage cart is the guest's to edit — the product has
 * always said so ("a price kept in the browser is a price a customer can
 * change"). These tests tamper with it the way a customer with devtools
 * could, and prove the screens re-derive everything from the menu.
 *
 * WHAT LIVES IN e2e/integration/security-flow.spec.ts INSTEAD
 *
 * The server-side half: place_public_order re-pricing a tampered submission,
 * expired and revoked QR tokens, unauthorised staff access through the proxy,
 * cross-tenant bill access, and duplicate order/payment writes. Those decide
 * against a real database and skip themselves without a deployment.
 */

test.describe('tampered client prices', () => {
  test('a price planted in the cart changes nothing: totals come from the menu', async ({
    page,
  }) => {
    // Exactly what a devtools-open guest could write: the line they want, at
    // the price they want.
    await seedCart(page, [
      {
        itemId: 'it-hara-bhara',
        qty: 2,
        price: 1,
        unitPricePaise: 1,
        lineTotalPaise: 1,
        pricePaise: 1,
      },
    ]);
    await page.goto('/menu/cart');
    await waitForAppReady(page);

    // ₹299 × 2, from the menu. Not ₹2, not ₹0.02.
    await expect(page.locator('dl').getByText('₹598')).toBeVisible();
    await expect(page.locator('dl').getByText('₹628')).toBeVisible(); // + 5% tax
  });

  test('the order form posts ids and quantities — never a price', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 2 }]);
    await page.goto('/menu/checkout');
    await waitForAppReady(page);

    // The hidden input is rendered empty on the server and filled from the
    // browser's cart after hydration; wait for the real line to land before
    // reading it.
    const input = page.locator('form#co-place-order input[name="lines"]');
    await expect(input).toHaveValue(/it-hara-bhara/);
    const raw = await input.inputValue();
    const lines = JSON.parse(raw) as Array<Record<string, unknown>>;

    expect(lines).toHaveLength(1);
    expect(lines[0].itemId).toBe('it-hara-bhara');
    expect(lines[0].qty).toBe(2);
    // Nothing money-shaped may leave the browser: the only currency of this
    // form is what was clicked.
    for (const line of lines) {
      for (const key of Object.keys(line)) {
        expect(['itemId', 'qty', 'variantId', 'addonIds']).toContain(key);
      }
    }
    expect(raw).not.toMatch(/price|paise|total/i);
  });
});

test.describe('invalid items and quantities', () => {
  test('an item that is not on the menu is named on screen, not silently billed', async ({
    page,
  }) => {
    await seedCart(page, [
      { itemId: 'it-hara-bhara', qty: 1 },
      { itemId: 'it-ghost-dish-9999', qty: 2 },
    ]);
    await page.goto('/menu/cart');
    await waitForAppReady(page);

    // The ghost id can neither be priced nor hidden: the screen says a dish
    // is no longer available and offers to remove it.
    const notice = page.getByText('One dish is no longer available, so it is not on the bill.');
    await expect(notice).toBeVisible();

    await page.getByRole('button', { name: 'Remove it from my cart' }).click();
    await expect(notice).toHaveCount(0);
    // The real dish is untouched; the ghost left with its button.
    await expect(page.getByText('Hara Bhara Kebab').first()).toBeVisible();
    await expect(page.getByText('it-ghost-dish-9999')).toHaveCount(0);
  });

  test('quantities outside 1–99 never reach the bill', async ({ page }) => {
    await seedCart(page, [
      { itemId: 'it-hara-bhara', qty: 999_999 },
      { itemId: 'it-dal-bukhara', qty: 0 },
      { itemId: 'it-seekh', qty: -3 },
    ]);
    await page.goto('/menu/cart');
    await waitForAppReady(page);

    // All three are refused at parse time: no line, no total, no crash — and
    // above all no ₹1 phantom row for a dish that was never really chosen.
    await expect(page.getByText('Hara Bhara Kebab')).toHaveCount(0);
    await expect(page.getByText('Dal Bukhara')).toHaveCount(0);
    await expect(page.getByText('Seekh Kebab')).toHaveCount(0);
    // The screen stays a working cart — tabs and all — with nothing on it.
    await expect(page.locator('[data-gtab-bar]')).toHaveCount(1);
  });

  test('the ceiling itself is honoured: 99 plates are 99 plates', async ({ page }) => {
    await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 99 }]);
    await page.goto('/menu/cart');
    await waitForAppReady(page);

    // 299 × 99 = 29,601 — the clamp is a boundary, not a suggestion.
    await expect(page.locator('dl').getByText('₹29,601')).toBeVisible();
  });
});

test.describe('routes that must fail honestly', () => {
  test('a bill address this deployment cannot resolve prints no money at all', async ({
    page,
  }) => {
    await page.goto('/bill/not-even-a-uuid');

    await expect(page.getByRole('heading', { name: 'Not connected' })).toBeVisible();
    await expect(page.locator('[data-bill]')).toHaveCount(0);
    // No error shape, no stack, no database detail.
    await expect(page.getByText('Postgres')).toHaveCount(0);
    await expect(page.getByText('supabase')).toHaveCount(0);
  });

  test('a problem-page reason that does not exist falls back to the plainest truth', async ({
    page,
  }) => {
    await page.goto('/t/problem?r=made-up-reason');

    await expect(page.getByRole('heading', { name: 'This card is not in use' })).toBeVisible();
    await expect(page.getByText('Table access')).toBeVisible();
    await expect(page.getByRole('link', { name: 'AutoDine home' })).toBeVisible();
  });
});
