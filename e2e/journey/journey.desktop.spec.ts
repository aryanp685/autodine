import { expect, test } from '@playwright/test';
import { a, b, cartCheckout, finishSitting, payments, place, prepareAndServe, scan, sql, staffContext, tickets } from './flow';

test('desktop: no direct menu access without a card; bad and revoked cards cannot order', async ({page}) => {
  await page.goto(`/menu?s=${a.slug}`);
  await expect(page.getByText('Journey thali', {exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading', {name:/open this menu from your table/i})).toBeVisible();
  await scan(page, a, 'A11');
  await expect(page.getByRole('heading', {name:'This card is not in use'})).toBeVisible();
  await scan(page, a, 'A12');
  // public_qr_intro intentionally doesn't distinguish unknown and revoked cards.
  await expect(page.getByRole('heading', {name:'This card is not in use'})).toBeVisible();
  expect(await tickets(a, 'A11')).toHaveLength(0);
  expect(await tickets(a, 'A12')).toHaveLength(0);
});

test('desktop: scan-and-confirm sitting, cash, close and saved plain receipt', async ({page, browser}) => {
  await scan(page, b, 'B1');
  await expect(page.getByText('Journey sibling dish', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Journey sibling dish' }).click();
  await cartCheckout(page);
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
  await place(page).dblclick();
  await expect(page).toHaveURL(/\/menu\/order\?/);
  const [ticket] = await tickets(b, 'B1');
  expect(await tickets(b, 'B1')).toHaveLength(1);
  expect(ticket).toMatchObject({ hold_required: true, confirmed_at: null, prep_status: 'new', total_paise: 10511, tax_paise: 0, payment_status: 'pending' });
  const desk = await staffContext(browser, 'sibling');
  try {
    const staff = await desk.newPage();
    await staff.goto('/kitchen');
    const ordinary = staff.locator('article[data-state]').filter({ hasText: ticket.code });
    await expect(ordinary).toHaveCount(0);
    const held = staff.getByRole('listitem').filter({ has: staff.getByText('Table B1', { exact: true }) });
    await held.getByRole('button', { name: 'Confirm table', exact: true }).click();
    await prepareAndServe(staff, ticket, 'Journey sibling dish');
    expect((await tickets(b, 'B1'))[0].confirmed_at).not.toBeNull();
    await staff.goto('/cashier');
    await staff.getByRole('button', { name: new RegExp(`^Select ${ticket.code} at B1`) }).click();
    // Lose the Next response after it actually recorded the cash. The
    // subsequent reload must not ask staff to collect another tender.
    await staff.route(url => url.pathname === '/cashier', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      await route.abort();
    });
    await staff.getByRole('button', { name: /Record cash.*105\.11/ }).click();
    await expect(staff.getByText(/^Recording could not be verified/)).toBeVisible();
    await expect(staff).toHaveURL(`/cashier?order=${ticket.id}`);
    await staff.unrouteAll();
    await staff.getByRole('link', { name: 'Check saved ticket', exact: true }).first().click();
    await expect(staff.locator('[data-bill-sheet]')).toContainText('Paid');
    await staff.goBack();
    await expect(staff).toHaveURL(`/cashier?order=${ticket.id}`);
    await staff.reload();
    await expect(staff.getByRole('button', { name: 'Check original recording' })).toBeEnabled();
    // Other unpaid tickets seeded by earlier flows cannot inherit this CTA.
    await expect(staff.locator('[data-counter-cta]:enabled')).toHaveCount(0);
    await staff.getByRole('button', { name: 'Check original recording' }).click();
    await expect(staff.getByRole('status').filter({ hasText: /CASH ₹105\.11 recorded/ })).toBeVisible();
    expect(await payments(ticket)).toEqual([{ method: 'cash', amount_paise: 10511, status: 'recorded', provider: 'counter', event_type: 'cash_collected' }]);
    await staff.goto(`/bill/${ticket.id}`);
    await expect(staff.locator('[data-bill-sheet]')).toContainText('₹105.11');
    await expect(staff.locator('[data-bill-sheet]')).toContainText('Paid');
    // The existing supplemental payment-receipt trigger only issues on a
    // payment after an already issued invoice. This is the usual flow.
    expect(await sql('select id from restaurant_invoices where order_session_id=$1', [ticket.order_session_id])).toHaveLength(0);
    const saved = await finishSitting(staff, ticket);
    expect(saved).toMatchObject({ document_type: 'receipt', irp_status: 'not_required',
      totals_snapshot: { total_paise: 10511, tax_paise: 0, amount_paid_paise: 10511, outstanding_paise: 0 },
      payment_snapshot: [{ method: 'cash', amount_paise: 10511 }] });
    await expect(staff.locator('[data-invoice-sheet]')).toContainText('₹105.11');
    await expect(staff.locator('[data-invoice-sheet]')).not.toContainText('CGST');
    expect(await sql('select id from restaurant_invoices where order_session_id=$1', [ticket.order_session_id])).toEqual([{id: saved.id}]);
  } finally { await desk.close(); }
});
