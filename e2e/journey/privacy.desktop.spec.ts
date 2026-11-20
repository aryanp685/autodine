import { expect, test } from '@playwright/test';
import { a, b, cartCheckout, fault, place, scan, sql, staffContext, tickets, venueCode, verify } from './flow';
import { PRIVATE_DETAIL } from './sentinel.mjs';

test('private guest edit and staff ledger errors expose references or safe copy, not driver details', async ({ page, browser }) => {
  await scan(page, a, 'A5');
  await page.getByRole('button', { name: 'Add Journey rice' }).click();
  await cartCheckout(page);
  await verify(page, await venueCode(a));
  await fault('place_public_order_attempt', 'private-error');
  await place(page).click();
  await expect(page.getByText(/^We could not confirm this order/)).toBeVisible();
  expect(page.url()).not.toContain(PRIVATE_DETAIL);
  expect(await tickets(a, 'A5')).toHaveLength(0);
  await page.goto(`/menu/checkout?s=${a.slug}`);
  await expect(place(page)).toHaveText('Retry same order');
  await place(page).click();
  await expect(page).toHaveURL(/\/menu\/order\?/);
  const [order] = await tickets(a, 'A5');
  await page.getByRole('button', { name: 'One more Journey rice' }).click();
  await fault('set_guest_order_lines_at_version', 'private-error');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/We could not change that order/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(PRIVATE_DETAIL);
  expect((await tickets(a, 'A5'))[0].total_paise).toBe(4201);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await tickets(a, 'A5'))[0].total_paise).toBe(8402);

  const manager = await staffContext(browser, 'manager');
  const sibling = await staffContext(browser, 'sibling');
  const kitchen = await staffContext(browser, 'kitchen');
  try {
    const ledger = await manager.newPage();
    await fault('report_sales', 'private-error');
    await ledger.goto('/dashboard/orders');
    await expect(ledger.getByRole('heading', { name: 'The rest of the dashboard still works' })).toBeVisible();
    await expect(ledger.locator('body')).not.toContainText(PRIVATE_DETAIL);
    await ledger.reload();
    await expect(ledger.getByText(order.code, { exact: true }).first()).toBeVisible();
    const foreign = await sibling.newPage();
    await foreign.goto('/dashboard/orders');
    await expect(foreign.getByText(order.code, { exact: true })).toHaveCount(0);
    await foreign.goto(`/cashier?order=${order.id}`);
    await expect(foreign.locator('[data-counter-cta]:enabled')).toHaveCount(0);
    await foreign.goto(`/bill/${order.id}`);
    await expect(foreign.locator('[data-bill-sheet]')).toHaveCount(0);
    const cook = await kitchen.newPage();
    await cook.goto(`/bill/${order.id}`);
    await expect(cook.locator('[data-bill-sheet]')).toHaveCount(0);
    await cook.goto(`/cashier?order=${order.id}`);
    await expect(cook.locator('[data-counter-cta]:enabled')).toHaveCount(0);
    expect(await sql('select id from payments where order_id=$1', [order.id])).toHaveLength(0);
    expect(await tickets(b, 'B5')).toHaveLength(0);
  } finally { await manager.close(); await sibling.close(); await kitchen.close(); }
});
