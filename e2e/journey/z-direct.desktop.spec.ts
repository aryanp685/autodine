import { expect, test } from '@playwright/test';
import { a, fault, finishSitting, prepareAndServe, sql, staffContext } from './flow';

test('staff-only direct takeaway and same-state delivery retain the private receipt boundary', async ({ browser }) => {
  const cashier = await staffContext(browser, 'cashier');
  const kitchen = await staffContext(browser, 'kitchen');
  const noAccess = await staffContext(browser, 'unassigned');
  const address = '88 Synthetic Delivery Lane';
  try {
    const staff = await cashier.newPage();
    const pass = await kitchen.newPage();
    const blocked = await noAccess.newPage();
    for (const page of [pass, blocked]) {
      await page.goto('/dashboard/direct-order');
      await expect(page.getByRole('button', { name: 'Record ticket' })).toHaveCount(0);
    }
    await staff.goto('/dashboard/direct-order');
    await staff.getByLabel('Menu item 1').selectOption(a.side);
    await staff.getByRole('checkbox', { name: /I verified this is direct restaurant service/ }).check();
    await staff.getByRole('button', { name: 'Record ticket' }).click();
    await expect(staff).toHaveURL(/\/dashboard#session-/);
    await expect(staff.locator('[data-active-session]').filter({ hasText: 'Takeaway' })).toContainText('₹42.01');
    const sessions = () => sql('select id,fulfilment_kind from order_sessions where restaurant_id=$1 and table_id is null order by opened_at', [a.id]);
    expect((await sessions()).map(row => row.fulfilment_kind)).toEqual(['takeaway']);
    await staff.goto('/dashboard/direct-order');
    await staff.getByLabel('Fulfilment').selectOption('direct_delivery');
    await staff.getByLabel('Destination state').selectOption('29');
    await staff.getByLabel('Delivery address (private)').fill(address);
    await staff.getByLabel('Menu item 1').selectOption(a.side);
    await staff.getByRole('checkbox', { name: /I verified this is direct restaurant service/ }).check();
    await staff.getByRole('button', { name: 'Record ticket' }).click();
    await expect(staff.getByText('Only direct same-state service is supported', { exact: false })).toBeVisible();
    expect(await sessions()).toHaveLength(1);

    await staff.getByLabel('Destination state').selectOption('27');
    await staff.getByRole('button', { name: 'Record ticket' }).click();
    await expect(staff).toHaveURL(/\/dashboard#session-/);
    const savedSessions = await sessions();
    expect(savedSessions.map(row => row.fulfilment_kind)).toEqual(['takeaway', 'direct_delivery']);
    const [ticket] = await sql<{id: string; code: string; order_session_id: string}>(`select id,code,order_session_id from orders where order_session_id=$1`, [savedSessions[1].id]);
    await pass.goto('/kitchen');
    const card = pass.locator('article[data-state]').filter({ hasText: ticket.code });
    await expect(card).toContainText('Direct delivery');
    await expect(pass.getByText(address, { exact: false })).toHaveCount(0);
    await prepareAndServe(pass, ticket, 'Journey rice');
    await staff.goto(`/cashier?order=${ticket.id}`);
    await staff.getByRole('button', { name: 'Card', exact: true }).click();
    await fault('record_counter_payment', 'before-query');
    await staff.getByRole('button', { name: /Record CARD.*42\.01/ }).click();
    await expect(staff.getByText(/^Recording could not be verified/)).toBeVisible();
    const noPayment = () => sql('select id from payments where order_id=$1', [ticket.id]);
    expect(await noPayment()).toHaveLength(0);
    await staff.reload();
    await expect(staff.getByText(/This device saved a Card recording for ₹42\.01/i)).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Cash', exact: true })).toHaveCount(0);
    await staff.getByRole('button', { name: 'Retry original recording' }).click();
    await expect(staff.getByText(/CARD ₹42\.01 recorded/)).toBeVisible();
    const [payment] = await sql('select method,amount_paise::int,status from payments where order_id=$1', [ticket.id]);
    expect(payment).toEqual({ method: 'card', amount_paise: 4201, status: 'recorded' });
    const saved = await finishSitting(staff, ticket, true);
    expect(saved).toMatchObject({ document_type: 'gst_tax_invoice', irp_status: 'not_required', customer_snapshot: { recipient_type: 'consumer', delivery_address: address } });
    await expect(staff.locator('[data-invoice-sheet]')).toContainText(address);
    await expect(staff.getByRole('button', { name: /Create 24-hour link|Share receipt text/ })).toHaveCount(0);
  } finally { await cashier.close(); await kitchen.close(); await noAccess.close(); }
});
