import { expect, test } from '@playwright/test';
import {
  cartCheckout, c, e, finishSitting, outletRole, payments, place, scan, sql, staffContext, tickets, venueCode, verify,
} from './flow';

/**
 * Journey B — an outlet with no GST registration, and a Composition outlet.
 *
 * Both run through the real guest menu, checkout, counter tender and checkout
 * RPCs. What is asserted is what the customer would be handed: the document
 * type, which identity fields print, whether a tax row appears, and that no
 * e-invoice workflow is involved.
 */
test.describe('no-GST outlets', () => {
  test('unregistered: retail receipt, no GSTIN or tax breakup, retry keeps one order', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await scan(page, e, 'E1');
    await expect(page).toHaveURL(`/menu?s=${e.slug}`);
    await page.getByRole('button', { name: 'Add Unregistered plate', exact: true }).click();
    await cartCheckout(page);
    await verify(page, await venueCode(e));

    // A committed order whose acknowledgement is lost must not double-charge
    // or double-write when the guest taps again.
    const { fault } = await import('./flow');
    await fault('place_public_order_attempt', 'after-commit');
    await place(page).click();
    await expect(page.getByText(/^We could not confirm that order/)).toBeVisible();
    const first = await tickets(e, 'E1');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ total_paise: 10511, tax_paise: 0, payment_status: 'pending' });
    await expect(place(page)).toHaveText('Retry same order');
    await place(page).click();
    await expect(page).toHaveURL(/\/menu\/order\?/);
    expect(await tickets(e, 'E1')).toHaveLength(1);
    expect(await page.evaluate(slug => localStorage.getItem(`autodine.cart.${slug}`), e.slug)).toBeNull();

    const [ticket] = await tickets(e, 'E1');
    const owner = await staffContext(browser, outletRole(e));
    try {
      const pos = await owner.newPage();
      await pos.goto(`/cashier?order=${ticket.id}`);
      await pos.getByRole('button', { name: /Record cash/ }).click();
      await expect(pos.getByRole('status').filter({ hasText: /cash .*recorded/i })).toBeVisible();
      expect(await payments(ticket)).toEqual([
        { method: 'cash', amount_paise: 10511, status: 'recorded', provider: 'counter', event_type: 'cash_collected' },
      ]);

      const saved = await finishSitting(pos, ticket);
      expect(saved).toMatchObject({ document_type: 'receipt', irp_status: 'not_required', gst_snapshot: null });
      expect(Number(saved.totals_snapshot.tax_paise)).toBe(0);
      expect(Number(saved.totals_snapshot.total_paise)).toBe(10511);

      const sheet = pos.locator('[data-invoice-sheet]');
      await expect(sheet).toContainText(saved.invoice_number);
      await expect(sheet).toContainText('Unregistered plate');
      await expect(sheet).not.toContainText('GSTIN');
      await expect(sheet).not.toContainText(/CGST|SGST|IGST/);
      await expect(sheet).not.toContainText(/IRN/);
      await expect(pos.getByRole('button', { name: 'Print / Save PDF' })).toBeVisible();
      // No e-invoice workflow was prepared, queued or attempted.
      expect(await sql('select id from restaurant_irp_jobs where invoice_id=$1', [saved.id])).toHaveLength(0);

      // A reload of the saved page shows the same immutable document.
      await pos.reload();
      await expect(pos.locator('[data-invoice-sheet]')).toContainText(saved.invoice_number);
      expect((await sql('select invoice_number, status from restaurant_invoices where id=$1', [saved.id]))[0])
        .toEqual({ invoice_number: saved.invoice_number, status: 'issued' });
    } finally { await owner.close(); }
  });

  test('composition: tax-free Bill of Supply with the statutory declaration', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await scan(page, c, 'C1');
    await expect(page).toHaveURL(`/menu?s=${c.slug}`);
    await page.getByRole('button', { name: 'Add Composition meal', exact: true }).click();
    await cartCheckout(page);
    await verify(page, await venueCode(c));
    await place(page).click();
    await expect(page).toHaveURL(/\/menu\/order\?/);

    const [ticket] = await tickets(c, 'C1');
    expect(ticket).toMatchObject({ total_paise: 10511, tax_paise: 0 });

    const owner = await staffContext(browser, outletRole(c));
    try {
      const pos = await owner.newPage();
      await pos.goto(`/cashier?order=${ticket.id}`);
      await pos.getByRole('button', { name: /Record cash/ }).click();
      await expect(pos.getByRole('status').filter({ hasText: /cash .*recorded/i })).toBeVisible();
      const saved = await finishSitting(pos, ticket);
      expect(saved).toMatchObject({ document_type: 'bill_of_supply', irp_status: 'not_required' });
      expect(saved.gst_snapshot.notice).toContain('Composition taxable person');
      expect(Number(saved.totals_snapshot.tax_paise)).toBe(0);
      expect(Number(saved.totals_snapshot.total_paise)).toBe(10511);

      const sheet = pos.locator('[data-invoice-sheet]');
      await expect(sheet).toContainText(/bill of supply/i);
      await expect(sheet).toContainText('Composition taxable person');
      await expect(sheet).toContainText('not eligible to collect tax');
      await expect(sheet).toContainText('GSTIN');
      await expect(sheet).toContainText('FSSAI');
      await expect(sheet).not.toContainText(/CGST|SGST|IGST/);
      await expect(sheet).not.toContainText(/IRN/);
      // A composition outlet cannot capture a registered buyer at checkout.
      expect(await sql('select id from restaurant_irp_jobs where invoice_id=$1', [saved.id])).toHaveLength(0);
      expect(await sql("select document_type from restaurant_invoices where id=$1", [saved.id]))
        .toEqual([{ document_type: 'bill_of_supply' }]);

      // The shared copy is the same tax-free document.
      await pos.getByRole('button', { name: 'Create 24-hour link' }).click();
      const link = new URL(await pos.getByLabel('New secure receipt link').inputValue());
      const shared = await page.context().newPage();
      await shared.goto(link.pathname);
      await expect(shared.locator('[data-invoice-sheet]')).toContainText(saved.invoice_number);
      await expect(shared.locator('[data-invoice-sheet]')).toContainText('Composition taxable person');
      await expect(shared.locator('[data-invoice-sheet]')).not.toContainText(/CGST|SGST/);
    } finally { await owner.close(); }
  });
});
