import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PRIVATE_DETAIL } from './sentinel.mjs';
import { a, b, cartCheckout, fault, finishSitting, payments, place, prepareAndServe, scan, sql, staffContext, tickets, venueCode, verify } from './flow';

test('phone: code, custom basket, lost acknowledgement, kitchen, UPI and saved GST receipt', async ({ page, browser }) => {
  test.setTimeout(130_000);
  const note = 'Less chilli, please';
  await scan(page, a, 'A1');
  await expect(page).toHaveURL(`/menu?s=${a.slug}`);
  await expect(page.getByText('Journey thali', { exact: true })).toBeVisible();
  await expect(page.getByText('Unpublished dish')).toHaveCount(0);
  await page.getByRole('link', { name: 'Choose', exact: true }).click();
  await page.getByText('Extra curd', { exact: true }).click();
  await page.getByRole('button', { name: 'Increase' }).click();
  await page.getByRole('button', { name: /add to order/i }).click();
  await expect(page).toHaveURL(new RegExp(`/menu\\?s=${a.slug}(?:&|$)`));
  await page.getByRole('button', { name: 'Add Journey rice', exact: true }).click();
  await cartCheckout(page);
  expect(await tickets(a, 'A1')).toHaveLength(0);
  const correct = await venueCode(a);
  const wrong = `${(Number(correct[0]) + 1) % 10}${correct.slice(1)}`;
  await page.getByLabel('Six-digit code').fill(wrong);
  await expect(page).toHaveURL(/[?&]e=(wrong|rotated)/);
  expect(await tickets(a, 'A1')).toHaveLength(0);
  await verify(page, await venueCode(a));
  await expect(page.getByText('At the counter', { exact: true })).toBeVisible();
  await expect(page.locator('[data-co-bar]')).toContainText('₹352.43');
  await page.locator('textarea[name=note]').fill(note);
  await fault('place_public_order_attempt', 'after-commit');
  await place(page).click();
  await expect(page.getByText(/^We could not confirm that order/)).toBeVisible();
  const [ticket] = await tickets(a, 'A1');
  expect(ticket).toMatchObject({ total_paise: 35243, tax_paise: 1678, payment_status: 'pending', prep_status: 'new', customer_note: note });
  expect(await payments(ticket)).toHaveLength(0);
  expect(await sql(`select qty,sort_order,name_snapshot,variant_snapshot,addons_snapshot from order_items where order_id=$1 order by sort_order`, [ticket.id])).toEqual([
    { qty: 2, sort_order: 1, name_snapshot: 'Journey thali', variant_snapshot: 'Large', addons_snapshot: ['Extra curd'] },
    { qty: 1, sort_order: 2, name_snapshot: 'Journey rice', variant_snapshot: null, addons_snapshot: [] },
  ]);
  await sql("update table_verification_sessions set expires_at=now()-interval '1 second' where table_id=$1", [a.tables.A1.id]);
  await page.reload();
  await verify(page, await venueCode(a));
  await expect(place(page)).toHaveText('Retry same order');
  await place(page).click();
  await expect(page).toHaveURL(/\/menu\/order\?/);
  await expect(page.getByText(ticket.code, { exact: true }).first()).toBeVisible();
  expect(await tickets(a, 'A1')).toHaveLength(1);
  expect(await page.evaluate(slug => localStorage.getItem(`autodine.cart.${slug}`) === null, a.slug)).toBe(true);
  const orderUrl = new URL(page.url());
  const { t } = Object.fromEntries(orderUrl.searchParams);
  const read = (slug: string, token: string) => page.request.post('/menu/orders/status', { data: { s: slug, code: ticket.code, t: token } });
  const status = await read(a.slug, t);
  expect(status.headers()['cache-control']).toContain('no-store');
  expect(Object.keys(await status.json()).sort()).toEqual(['awaitingConfirmation','checkedAt','ok','paymentStatus','placedAt','status','revision'].sort());
  expect(await (await read(b.slug, t)).json()).toEqual({ ok: false, reason: 'not_found' });
  expect(await (await read(a.slug, randomUUID())).json()).toEqual({ ok: false, reason: 'not_found' });
  expect(await (await read(a.slug, 'malformed')).json()).toEqual({ ok: false, reason: 'not_found' });

  const kitchen = await staffContext(browser, 'kitchen');
  const counter = await staffContext(browser, 'cashier');
  const sibling = await staffContext(browser, 'sibling');
  try {
    const pass = await kitchen.newPage();
    await pass.goto('/kitchen');
    await prepareAndServe(pass, ticket, 'Journey thali', note);
    await page.bringToFront();
    await expect(page.getByText(/Please settle the bill at the counter before you leave/i)).toBeVisible({ timeout: 20_000 });
    expect(await (await read(a.slug, t)).json()).toMatchObject({ status: 'served', paymentStatus: 'pending' });

    const pos = await counter.newPage();
    await pos.goto('/dashboard');
    await expect(pos.locator(`[data-active-session="${ticket.order_session_id}"]`)).toContainText('Settle the outstanding balance');
    await pos.goto(`/cashier?order=${ticket.id}`);
    await pos.getByRole('button', { name: 'UPI', exact: true }).click();
    await fault('record_counter_payment', 'after-commit');
    await pos.getByRole('button', { name: /Record UPI.*352\.43/ }).click();
    await expect(pos.getByRole('status').filter({ hasText: /UPI ₹352\.43 recorded/ })).toBeVisible();
    expect(await payments(ticket)).toEqual([{ method: 'upi', amount_paise: 35243, status: 'recorded', provider: 'counter', event_type: 'upi_collected' }]);
    await page.bringToFront();
    await expect(page.getByText('Paid. Thank you.', { exact: true })).toBeVisible({ timeout: 20_000 });
    const saved = await finishSitting(pos, ticket);
    expect(saved).toMatchObject({ document_type: 'gst_tax_invoice', irp_status: 'not_required',
      totals_snapshot: { total_paise: 35243, tax_paise: 1678, amount_paid_paise: 35243, outstanding_paise: 0 },
      payment_snapshot: [{ method: 'upi', amount_paise: 35243 }] });
    await expect(pos.locator('[data-invoice-sheet]')).toContainText('₹352.43');
    await expect(pos.locator('[data-invoice-sheet]')).toContainText('Journey thali');
    await expect(pos.locator('[data-invoice-sheet]')).toContainText('CGST');
    const other = await sibling.newPage();
    await other.goto(`/invoice/${saved.id}`);
    await expect(other.locator('[data-invoice-sheet]')).toHaveCount(0);

    await fault('create_restaurant_invoice_share_link', 'private-error');
    await pos.getByRole('button', { name: 'Create 24-hour link' }).click();
    await expect(pos.getByText(/could not verify a share link/i)).toBeVisible();
    await expect(pos.locator('body')).not.toContainText(PRIVATE_DETAIL);
    expect(await sql('select id from restaurant_invoice_share_links where invoice_id=$1', [saved.id])).toHaveLength(0);
    await pos.getByRole('button', { name: 'Create 24-hour link' }).click();
    const link = pos.getByLabel('New secure receipt link');
    await expect(link).toBeVisible();
    const share = new URL(await link.inputValue());
    expect(share.origin === new URL(pos.url()).origin).toBe(true);
    const shared = await page.context().newPage();
    const response = await shared.goto(share.pathname);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    await expect(shared.locator('[data-invoice-sheet]')).toContainText(saved.invoice_number);
    await expect(shared.getByRole('button', { name: 'Create 24-hour link' })).toHaveCount(0);
    await pos.getByRole('button', { name: 'Revoke link', exact: true }).click();
    await expect(pos.getByText('Receipt link revoked.', { exact: true })).toBeVisible();
    await shared.reload();
    await expect(shared.getByRole('heading', { name: 'This link is unavailable' })).toBeVisible();

    await pos.getByRole('button', { name: 'Create 24-hour link' }).click();
    await expect(link).toBeVisible();
    const nextShare = new URL(await link.inputValue());
    const digest = createHash('sha256').update(nextShare.pathname.split('/').at(-1)!).digest('hex');
    const linkRows = await sql(`select id, created_at, expires_at, extract(epoch from expires_at - created_at)::int as lifetime
      from restaurant_invoice_share_links where token_hash=$1 and invoice_id=$2`, [digest, saved.id]);
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0].lifetime).toBe(86400);
    await sql(`update restaurant_invoice_share_links set created_at=now()-interval '25 hours', expires_at=now()-interval '1 hour' where id=$1`, [linkRows[0].id]);
    await shared.goto(nextShare.pathname);
    await expect(shared.getByRole('heading', { name: 'This link is unavailable' })).toBeVisible();
    await expect(shared.locator('[data-invoice-sheet]')).toHaveCount(0);
  } finally { await kitchen.close(); await counter.close(); await sibling.close(); }
});
