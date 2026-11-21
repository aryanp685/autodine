import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const URL_VALUE = process.env.READINESS_DB_URL || '';
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)
  ) {
    throw new Error('Billing v2 tests require a locally-created disposable autodine_check_* database');
  }
}

let db: Client;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await db.query('set local role authenticated');
    const result = await fn();
    await db.query('commit');
    return result;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}

async function seedFixture() {
  const ownerId = randomUUID();
  const managerId = randomUUID();
  const cashierId = randomUUID();
  const slug = `bv2-${randomUUID().slice(0, 8)}`;

  await db.query('insert into profiles(id) values ($1), ($2), ($3)', [ownerId, managerId, cashierId]);

  const restaurantId: string = (
    await db.query(
      `insert into restaurants(
         slug, name, address, phone, tax_rate_bps, guest_verification_mode,
         fssai_number, bill_footer_note,
         default_service_charge_bps, default_packaging_charge_paise,
         default_delivery_charge_paise, round_off_enabled
       )
       values (
         $1, 'Billing V2 Bistro', '10 MG Road, Nagpur', '9876543210', 0, 'scan',
         '11524001000123', 'Thank you for dining with Billing V2 Bistro!',
         500, 1500, 3500, true
       )
       returning id`,
      [slug],
    )
  ).rows[0].id;

  await db.query(
    `insert into memberships(restaurant_id, user_id, role)
     values ($1, $2, 'owner'), ($1, $3, 'manager'), ($1, $4, 'cashier')`,
    [restaurantId, ownerId, managerId, cashierId],
  );

  // Enable Regular 5% GST so tax extraction + pre-tax discount math are tested end-to-end.
  const gstin = '27ABCDE1234F1Z5';
  await db.query(
    `insert into restaurant_gst_config(
       restaurant_id, mode, regular_profile, gstin, legal_name, trade_name,
       address, state_code, pan, registration_type
     ) values (
       $1, 'regular', 'other_than_specified_premises', $2,
       'Billing V2 Bistro Pvt Ltd', 'Billing V2 Bistro',
       '10 MG Road, Nagpur', '27', 'ABCDE1234F', 'regular'
     )`,
    [restaurantId, gstin],
  );

  const menuId: string = (
    await db.query(
      `insert into menus(restaurant_id, name, is_published) values ($1, 'Main', true) returning id`,
      [restaurantId],
    )
  ).rows[0].id;
  const catId: string = (
    await db.query(
      `insert into categories(restaurant_id, menu_id, name) values ($1, $2, 'Mains') returning id`,
      [restaurantId, menuId],
    )
  ).rows[0].id;
  // ₹105.00 inclusive item (exactly ₹100 taxable + ₹5 GST at 5%)
  const itemId: string = (
    await db.query(
      `insert into items(restaurant_id, category_id, name, price_paise, is_available)
       values ($1, $2, 'Paneer Tikka', 10500, true) returning id`,
      [restaurantId, catId],
    )
  ).rows[0].id;
  const tableId: string = (
    await db.query(
      `insert into dining_tables(restaurant_id, label) values ($1, 'T1') returning id`,
      [restaurantId],
    )
  ).rows[0].id;

  return { ownerId, managerId, cashierId, restaurantId, itemId, tableId, slug };
}

describe.skipIf(!URL_VALUE)('Billing Spec v2.0 (disposable PostgreSQL)', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: URL_VALUE });
    await db.connect();
  }, 30000);

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  });

  it('creates dine-in, takeaway, and delivery counter orders with default charges and concurrent null-table sessions', async () => {
    const { cashierId, restaurantId, itemId, tableId } = await seedFixture();

    const dineIn = await asUser(cashierId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'dine_in', $2, $3::jsonb, 'No onion', null, null) as res`,
        [restaurantId, tableId, JSON.stringify([{ item_id: itemId, qty: 2 }])],
      );
      return r.rows[0].res;
    });
    expect(dineIn.code).toMatch(/^[A-Z]{2}-[A-Z0-9]{5}$/);

    // 2 * 10500 = 21000 subtotal; 5% service charge = 1050 -> 22050 -> round_off_enabled rounds to 22100 (+50)
    const dineInRow = (
      await db.query(
        `select subtotal_paise, service_charge_paise, packaging_charge_paise, delivery_charge_paise, round_off_paise, total_paise, order_channel
           from orders where id = $1`,
        [dineIn.order_id],
      )
    ).rows[0];
    expect(Number(dineInRow.subtotal_paise)).toBe(21000);
    expect(Number(dineInRow.service_charge_paise)).toBe(1050);
    expect(Number(dineInRow.packaging_charge_paise)).toBe(0);
    expect(Number(dineInRow.delivery_charge_paise)).toBe(0);
    expect(Number(dineInRow.round_off_paise)).toBe(50);
    expect(Number(dineInRow.total_paise)).toBe(22100);
    expect(dineInRow.order_channel).toBe('dine_in');

    // Two concurrent open takeaway & delivery sessions with NULL table_id must both succeed
    const takeaway = await asUser(cashierId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'takeaway', null, $2::jsonb, null, 'Asha', '9876543210') as res`,
        [restaurantId, JSON.stringify([{ item_id: itemId, qty: 1 }])],
      );
      return r.rows[0].res;
    });
    const delivery = await asUser(cashierId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'delivery', null, $2::jsonb, null, 'Ravi', '9876500000') as res`,
        [restaurantId, JSON.stringify([{ item_id: itemId, qty: 1 }])],
      );
      return r.rows[0].res;
    });
    expect(takeaway.order_session_id).not.toBe(delivery.order_session_id);

    const delRow = (
      await db.query(
        `select packaging_charge_paise, delivery_charge_paise, total_paise from orders where id = $1`,
        [delivery.order_id],
      )
    ).rows[0];
    // 10500 + 1500 packaging + 3500 delivery = 15500
    expect(Number(delRow.packaging_charge_paise)).toBe(1500);
    expect(Number(delRow.delivery_charge_paise)).toBe(3500);
    expect(Number(delRow.total_paise)).toBe(15500);
  }, 20000);

  it('enforces role-gated discounts, complimentary approval, split payments, refunds, invoice snapshots, reprints, and reports', async () => {
    const { ownerId, managerId, cashierId, restaurantId, itemId, tableId } = await seedFixture();

    const created = await asUser(cashierId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'dine_in', $2, $3::jsonb, null, null, null) as res`,
        [restaurantId, tableId, JSON.stringify([{ item_id: itemId, qty: 2 }])],
      );
      return r.rows[0].res;
    });
    const orderId: string = created.order_id;
    const sessionId: string = created.order_session_id;

    // Cashier > 20% discount is refused
    await expect(
      asUser(cashierId, () =>
        db.query(
          `select apply_order_billing_adjustment($1, 5000, 'VIP', 0, 0, 0, false, false, null)`,
          [orderId],
        ),
      ),
    ).rejects.toThrow(/20%/);

    // Cashier complimentary is refused
    await expect(
      asUser(cashierId, () =>
        db.query(
          `select apply_order_billing_adjustment($1, 0, null, 0, 0, 0, false, true, 'Owner guest')`,
          [orderId],
        ),
      ),
    ).rejects.toThrow(/owner or manager/i);

    // Cashier 10% discount (₹21 on ₹210) with ₹0 charges and round-off off -> net ₹189.00, tax = 18900 - round(18900*10000/10500) = 900 paise
    const adj = await asUser(cashierId, async () => {
      const r = await db.query(
        `select apply_order_billing_adjustment($1, 2100, 'Regular guest 10%', 0, 0, 0, false, false, null) as res`,
        [orderId],
      );
      return r.rows[0].res;
    });
    expect(Number(adj.total_paise)).toBe(18900);
    expect(Number(adj.tax_paise)).toBe(900);

    // Partial split payment (₹100 cash) keeps order pending
    const splitKey1 = randomUUID();
    const part1 = await asUser(cashierId, async () => {
      const r = await db.query(
        `select record_split_counter_payments($1, $2::jsonb, $3::uuid) as res`,
        [orderId, JSON.stringify([{ method: 'cash', amount_paise: 10000, split_label: 'Guest A' }]), splitKey1],
      );
      return r.rows[0].res;
    });
    expect(part1.payment_status).toBe('pending');
    expect(Number(part1.outstanding_paise)).toBe(8900);

    // Idempotent retry returns the same payment ID without double-charging
    const part1Retry = await asUser(cashierId, async () => {
      const r = await db.query(
        `select record_split_counter_payments($1, $2::jsonb, $3::uuid) as res`,
        [orderId, JSON.stringify([{ method: 'cash', amount_paise: 10000, split_label: 'Guest A' }]), splitKey1],
      );
      return r.rows[0].res;
    });
    expect(part1Retry.payment_ids).toEqual(part1.payment_ids);

    // Settle remaining ₹89 via UPI -> flips order to paid
    const part2 = await asUser(cashierId, async () => {
      const r = await db.query(
        `select record_split_counter_payments($1, $2::jsonb, $3::uuid) as res`,
        [orderId, JSON.stringify([{ method: 'upi', amount_paise: 8900, split_label: 'Guest B' }]), randomUUID()],
      );
      return r.rows[0].res;
    });
    expect(part2.payment_status).toBe('paid');
    expect(Number(part2.outstanding_paise)).toBe(0);

    // Cashier refund is refused; manager partial cash refund (₹20) succeeds; over-refund refused
    const cashPaymentId: string = part1.payment_ids[0];
    await expect(
      asUser(cashierId, () =>
        db.query(`select record_counter_refund($1, 2000, 'Spilled', $2::uuid)`, [cashPaymentId, randomUUID()]),
      ),
    ).rejects.toThrow(/owner or manager/i);

    const refund1 = await asUser(managerId, async () => {
      const r = await db.query(
        `select record_counter_refund($1, 2000, 'Wrong chutney', $2::uuid) as res`,
        [cashPaymentId, randomUUID()],
      );
      return r.rows[0].res;
    });
    expect(Number(refund1.amount_paise)).toBe(2000);

    await expect(
      asUser(ownerId, () =>
        db.query(`select record_counter_refund($1, 9000, 'Too much', $2::uuid)`, [cashPaymentId, randomUUID()]),
      ),
    ).rejects.toThrow(/remaining refundable/i);

    // Close session -> immutable invoice carries FSSAI, bill footer note, and discount totals
    const invoiceId: string = await asUser(cashierId, async () => {
      const r = await db.query(`select close_order_session_and_issue_receipt($1, null) as id`, [sessionId]);
      return r.rows[0].id;
    });

    const inv = (
      await db.query(
        `select document_type, seller_snapshot, totals_snapshot from restaurant_invoices where id = $1`,
        [invoiceId],
      )
    ).rows[0];
    expect(inv.document_type).toBe('gst_tax_invoice');
    expect(inv.seller_snapshot.fssai_number).toBe('11524001000123');
    expect(inv.seller_snapshot.bill_footer_note).toBe('Thank you for dining with Billing V2 Bistro!');
    expect(Number(inv.totals_snapshot.ticket_discount_paise)).toBe(2100);

    // Reprints: first print = original, second print = DUPLICATE, immutable trigger rejects mutation
    const p1 = await asUser(cashierId, async () => {
      const r = await db.query(`select record_invoice_reprint($1, '80mm') as res`, [invoiceId]);
      return r.rows[0].res;
    });
    const p2 = await asUser(cashierId, async () => {
      const r = await db.query(`select record_invoice_reprint($1, 'pdf') as res`, [invoiceId]);
      return r.rows[0].res;
    });
    expect(p1).toMatchObject({ copy_number: 1, is_duplicate: false });
    expect(p2).toMatchObject({ copy_number: 2, is_duplicate: true });
    await expect(
      db.query(`update restaurant_invoice_reprints set format = 'a4' where invoice_id = $1`, [invoiceId]),
    ).rejects.toThrow(/immutable/i);

    // Reports: cashier denied, owner/manager gets accurate GST, adjustments, and expected cash drawer (10000 - 2000 = 8000)
    await expect(
      asUser(cashierId, () =>
        db.query(`select report_day_end_closing($1, current_date, 'Asia/Kolkata')`, [restaurantId]),
      ),
    ).rejects.toThrow(/do not manage/i);

    const zReport = await asUser(ownerId, async () => {
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      const summary = (
        await db.query(`select report_billing_summary($1, $2::timestamptz, $3::timestamptz, 'Asia/Kolkata') as res`, [
          restaurantId,
          from,
          to,
        ])
      ).rows[0].res;
      const dayClose = (
        await db.query(
          `select report_day_end_closing($1, (now() at time zone 'Asia/Kolkata')::date, 'Asia/Kolkata') as res`,
          [restaurantId],
        )
      ).rows[0].res;
      return { summary, dayClose };
    });

    expect(Number(zReport.summary.adjustments.discount_paise)).toBe(2100);
    expect(Number(zReport.summary.adjustments.refunded_paise)).toBe(2000);
    expect(Number(zReport.summary.adjustments.duplicate_reprints)).toBe(1);
    expect(Number(zReport.dayClose.cash_collected_paise)).toBe(10000);
    expect(Number(zReport.dayClose.upi_collected_paise)).toBe(8900);
    expect(Number(zReport.dayClose.cash_refunded_paise)).toBe(2000);
    expect(Number(zReport.dayClose.expected_cash_drawer_paise)).toBe(8000);
  }, 25000);
});
