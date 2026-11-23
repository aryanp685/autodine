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

  it('allows staff to read billing settings only for their own restaurant without exposing account billing', async () => {
    const { ownerId, managerId, cashierId, restaurantId } = await seedFixture();
    const other = await seedFixture();
    const columns = 'id, fssai_number, bill_footer_note, default_service_charge_bps, default_packaging_charge_paise, default_delivery_charge_paise, round_off_enabled';
    for (const userId of [ownerId, managerId, cashierId]) {
      const rows = await asUser(userId, () => db.query(`select ${columns} from restaurants`));
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ id: restaurantId, fssai_number: '11524001000123' });
      expect(rows.rows.some((row) => row.id === other.restaurantId)).toBe(false);
      await expect(asUser(userId, () => db.query('select account_id, plan from restaurants')))
        .rejects.toThrow(/permission denied/);
    }
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

  it('supports waiter role boundaries, restaurant coupons, and splitting a bill into multiple sequential invoices', async () => {
    const { ownerId, cashierId, restaurantId, itemId, tableId } = await seedFixture();

    const waiterId = randomUUID();
    await db.query(`insert into profiles(id) values ($1)`, [waiterId]);
    await db.query(
      `insert into memberships(restaurant_id, user_id, role) values ($1, $2, 'waiter')`,
      [restaurantId, waiterId],
    );

    // Waiter can create a dine-in counter order and cannot apply coupons, split bills, or take payment.
    const waiterOrder = await asUser(waiterId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'dine_in', $2, $3::jsonb, 'Window table', null, null) as res`,
        [restaurantId, tableId, JSON.stringify([{ item_id: itemId, qty: 2 }])],
      );
      return r.rows[0].res;
    });
    expect(waiterOrder.order_id).toBeTruthy();

    await expect(
      asUser(waiterId, () =>
        db.query(`select apply_coupon_to_order($1, 'WELCOME10')`, [waiterOrder.order_id]),
      ),
    ).rejects.toThrow(/permission/i);
    await expect(
      asUser(waiterId, () =>
        db.query(`select split_order_session_for_billing($1, null, null)`, [waiterOrder.order_session_id]),
      ),
    ).rejects.toThrow(/owner, manager, or cashier/i);
    await expect(
      asUser(waiterId, () =>
        db.query(
          `select record_split_counter_payments($1, $2::jsonb, $3::uuid)`,
          [waiterOrder.order_id, JSON.stringify([{ method: 'cash', amount_paise: 100 }]), randomUUID()],
        ),
      ),
    ).rejects.toThrow(/permission|cashier|owner/i);

    // Owner creates coupon WELCOME10: 10% off (1000 bps), min order ₹150 (15000 paise), max cap ₹20 (2000 paise)
    const coupon = await asUser(ownerId, async () => {
      const r = await db.query(
        `select upsert_restaurant_coupon($1, 'WELCOME10', 'percent', 1000, 15000, 2000, 5, null, null, '10% welcome discount', true) as res`,
        [restaurantId],
      );
      return r.rows[0].res;
    });
    expect(coupon.code).toBe('WELCOME10');

    // Split waiterOrder (qty 2 of 10500 paise) into 2 separate bills (1 qty stays, 1 qty moves to split session)
    const oiRow = (
      await db.query(`select id from order_items where order_id = $1 limit 1`, [waiterOrder.order_id])
    ).rows[0];
    const splitRes = await asUser(cashierId, async () => {
      const r = await db.query(
        `select split_order_session_for_billing($1, null, $2::jsonb) as res`,
        [
          waiterOrder.order_session_id,
          JSON.stringify([{ order_item_id: oiRow.id, quantity: 1 }]),
        ],
      );
      return r.rows[0].res;
    });
    expect(splitRes.new_session_id).toBeTruthy();
    expect(splitRes.new_order_id).toBeTruthy();

    // Source order is now 10500 subtotal (< 15000 min order), so WELCOME10 rejects cleanly!
    await expect(
      asUser(cashierId, () =>
        db.query(`select apply_coupon_to_order($1, 'WELCOME10')`, [waiterOrder.order_id]),
      ),
    ).rejects.toThrow(/below the minimum/i);

    // Add a second order of qty 2 (21000 subtotal) on a takeaway session, apply WELCOME10 -> 10% = 2100 capped to 2000!
    const takeaway = await asUser(cashierId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'takeaway', null, $2::jsonb, null, 'Guest B', null) as res`,
        [restaurantId, JSON.stringify([{ item_id: itemId, qty: 2 }])],
      );
      return r.rows[0].res;
    });
    const applied = await asUser(cashierId, async () => {
      const r = await db.query(`select apply_coupon_to_order($1, 'welcome10') as res`, [takeaway.order_id]);
      return r.rows[0].res;
    });
    expect(applied.coupon_code).toBe('WELCOME10');
    expect(Number(applied.discount_paise)).toBe(2000);

    // Settle both split bills independently and issue 2 separate sequential invoices (one B2C, one B2B GSTIN)!
    const origRow = (await db.query(`select total_paise from orders where id = $1`, [waiterOrder.order_id])).rows[0];
    const splitRow = (await db.query(`select total_paise from orders where id = $1`, [splitRes.new_order_id])).rows[0];

    await asUser(cashierId, async () => {
      await db.query(
        `select record_split_counter_payments($1, $2::jsonb, $3::uuid)`,
        [waiterOrder.order_id, JSON.stringify([{ method: 'cash', amount_paise: Number(origRow.total_paise) }]), randomUUID()],
      );
      await db.query(
        `select record_split_counter_payments($1, $2::jsonb, $3::uuid)`,
        [splitRes.new_order_id, JSON.stringify([{ method: 'upi', amount_paise: Number(splitRow.total_paise) }]), randomUUID()],
      );
    });

    const inv1 = await asUser(cashierId, async () => {
      const r = await db.query(`select close_order_session_and_issue_receipt($1, null) as id`, [
        waiterOrder.order_session_id,
      ]);
      return r.rows[0].id;
    });
    const inv2 = await asUser(cashierId, async () => {
      const r = await db.query(
        `select close_order_session_and_issue_receipt($1, $2::jsonb) as id`,
        [
          splitRes.new_session_id,
          JSON.stringify({ name: 'Acme Hospitality LLP', gstin: '27ABCDE1234F1Z5' }),
        ],
      );
      return r.rows[0].id;
    });

    expect(inv1).not.toBe(inv2);
    const invRows = (
      await db.query(
        `select id, invoice_number, table_label_snapshot, customer_snapshot, recipient_gstin from restaurant_invoices where id = any($1::uuid[]) order by sequence_number asc`,
        [[inv1, inv2]],
      )
    ).rows;
    expect(invRows).toHaveLength(2);
    expect(invRows[0].invoice_number).not.toBe(invRows[1].invoice_number);
    expect(invRows[0].table_label_snapshot).toBe('T1');
    expect(invRows[1].table_label_snapshot).toContain('T1');
    expect(invRows[1].recipient_gstin).toBe('27ABCDE1234F1Z5');
    expect(invRows[1].customer_snapshot?.gstin).toBe('27ABCDE1234F1Z5');
  }, 25000);

  it('manages restaurant_printers and enforces IRP immutability, sandbox guard, live IRN storage, and 24h cancellation', async () => {
    const { ownerId, cashierId, restaurantId, itemId, tableId } = await seedFixture();

    // 1. Printer CRUD & RBAC
    await expect(
      asUser(cashierId, () =>
        db.query(
          `select upsert_restaurant_printer($1, null, 'Counter 80mm', 'counter', 'thermal', 'windows_bridge', '80mm', 'Epson TM-T82', null, null, true, true)`,
          [restaurantId],
        ),
      ),
    ).rejects.toThrow(/owner or manager/i);

    const printer = await asUser(ownerId, async () => {
      const r = await db.query(
        `select * from upsert_restaurant_printer($1, null, 'Counter 80mm', 'counter', 'thermal', 'windows_bridge', '80mm', 'Epson TM-T82', null, null, true, true)`,
        [restaurantId],
      );
      return r.rows[0];
    });
    expect(printer.name).toBe('Counter 80mm');
    expect(printer.is_default).toBe(true);
    expect(printer.auto_print_on_close).toBe(true);

    const updatedPrinter = await asUser(cashierId, async () => {
      const r = await db.query(
        `select * from record_restaurant_printer_status($1, 'connected', null)`,
        [printer.id],
      );
      return r.rows[0];
    });
    expect(updatedPrinter.status).toBe('connected');

    // 2. Regular GST B2B invoice -> IRP persistence & guards
    await db.query(
      `insert into restaurant_gst_config (
         restaurant_id, mode, regular_profile, gstin, legal_name, trade_name,
         address, state_code, pan, registration_type, preceding_fy_turnover_paise,
         einvoice_location, einvoice_pincode, einvoice_hsn_sac
       ) values (
         $1, 'regular', 'other_than_specified_premises', '27BILLV0001B1ZY',
         'Billing V2 Bistro LLP', 'Billing V2 Bistro', '10 MG Road, Nagpur',
         '27', 'BILLV0001B', 'regular', 6000000000, 'Nagpur', '440001', '996331'
       )
       on conflict (restaurant_id) do update set
         mode = excluded.mode,
         regular_profile = excluded.regular_profile,
         gstin = excluded.gstin,
         legal_name = excluded.legal_name,
         trade_name = excluded.trade_name,
         address = excluded.address,
         state_code = excluded.state_code,
         pan = excluded.pan,
         registration_type = excluded.registration_type,
         preceding_fy_turnover_paise = excluded.preceding_fy_turnover_paise,
         einvoice_location = excluded.einvoice_location,
         einvoice_pincode = excluded.einvoice_pincode,
         einvoice_hsn_sac = excluded.einvoice_hsn_sac`,
      [restaurantId],
    );

    const orderRes = await asUser(cashierId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'dine_in', $2, $3::jsonb, null, null, null) as res`,
        [restaurantId, tableId, JSON.stringify([{ item_id: itemId, qty: 2 }])],
      );
      return r.rows[0].res;
    });
    const orderRow = (await db.query(`select total_paise from orders where id = $1`, [orderRes.order_id])).rows[0];
    await asUser(cashierId, () =>
      db.query(
        `select record_split_counter_payments($1, $2::jsonb, $3::uuid)`,
        [orderRes.order_id, JSON.stringify([{ method: 'cash', amount_paise: Number(orderRow.total_paise) }]), randomUUID()],
      ),
    );
    const invId = await asUser(cashierId, async () => {
      const r = await db.query(
        `select close_order_session_and_issue_receipt($1, $2::jsonb) as id`,
        [orderRes.order_session_id, JSON.stringify({ name: 'Buyer LLP', gstin: '27BBBBB1111B1Z9' })],
      );
      return r.rows[0].id;
    });

    // Direct SQL tampering with IRN/IRP status MUST remain blocked by restaurant_invoices_immutable()
    await expect(
      db.query(`update restaurant_invoices set irp_status = 'generated', irn = $2 where id = $1`, [
        invId,
        'a'.repeat(64),
      ]),
    ).rejects.toThrow(/immutable/i);

    // Offline sandbox MUST NEVER mark an invoice as generated
    await expect(
      asUser(ownerId, () =>
        db.query(
          `select complete_restaurant_invoice_irp($1, 'sandbox', 'generated', $2, '123456', now(), 'QR', 'r1', 'r2')`,
          [invId, 'a'.repeat(64)],
        ),
      ),
    ).rejects.toThrow(/sandbox/i);

    // Live provider ('nic_gsp') persists IRN + Ack No + Signed QR Payload + audit row
    const liveIrn = 'd'.repeat(64);
    const genRes = await asUser(cashierId, async () => {
      const r = await db.query(
        `select complete_restaurant_invoice_irp($1, 'nic_gsp', 'generated', $2, '9988776655', now(), 'SIGNED-QR-JWT', 'reqsha', 'ressha') as res`,
        [invId, liveIrn],
      );
      return r.rows[0].res;
    });
    expect(genRes.irp_status).toBe('generated');
    expect(genRes.irn).toBe(liveIrn);

    const storedInv = (
      await db.query(
        `select irp_status, irn, ack_no, signed_qr_payload, irp_provider from restaurant_invoices where id = $1`,
        [invId],
      )
    ).rows[0];
    expect(storedInv).toMatchObject({
      irp_status: 'generated',
      irn: liveIrn,
      ack_no: '9988776655',
      signed_qr_payload: 'SIGNED-QR-JWT',
      irp_provider: 'nic_gsp',
    });

    // Cashier cannot cancel IRN; owner cancels within 24h
    await expect(
      asUser(cashierId, () =>
        db.query(`select cancel_restaurant_invoice_irp($1, 'nic_gsp', '2', 'Wrong GSTIN')`, [invId]),
      ),
    ).rejects.toThrow(/owner or manager/i);

    const cancelRes = await asUser(ownerId, async () => {
      const r = await db.query(
        `select cancel_restaurant_invoice_irp($1, 'nic_gsp', '2', 'Wrong GSTIN') as res`,
        [invId],
      );
      return r.rows[0].res;
    });
    expect(cancelRes.irp_status).toBe('cancelled');

    const deleted = await asUser(ownerId, async () => {
      const r = await db.query(`select delete_restaurant_printer($1) as ok`, [printer.id]);
      return r.rows[0].ok;
    });
    expect(deleted).toBe(true);
  }, 25000);

  it('persists Mode A / Mode B operating paths, isolates POS webhook credentials, and enforces KOT handoff permissions', async () => {
    const { ownerId, cashierId, restaurantId, itemId, tableId } = await seedFixture();

    const kitchenId = randomUUID();
    await db.query(`insert into profiles(id) values ($1)`, [kitchenId]);
    await db.query(
      `insert into memberships(restaurant_id, user_id, role) values ($1, $2, 'kitchen')`,
      [restaurantId, kitchenId],
    );

    // Default operating mode is 'mode_b'
    const initialMode = (
      await asUser(kitchenId, () =>
        db.query(`select operating_mode, pos_integration_name from restaurants where id = $1`, [
          restaurantId,
        ]),
      )
    ).rows[0];
    expect(initialMode.operating_mode).toBe('mode_b');
    expect(initialMode.pos_integration_name).toBeNull();

    // Cashier cannot change operating mode or POS integration settings
    await expect(
      asUser(cashierId, () =>
        db.query(
          `select save_restaurant_operating_mode($1, 'mode_a', 'Petpooja', 'https://pos.example.com/kot', 'sec-1')`,
          [restaurantId],
        ),
      ),
    ).rejects.toThrow(/owner or manager/i);

    // Owner configures Mode A alongside Petpooja with a signed webhook
    const saved = await asUser(ownerId, async () => {
      const r = await db.query(
        `select save_restaurant_operating_mode($1, 'mode_a', 'Petpooja', 'https://pos.example.com/kot', 'sec-123') as res`,
        [restaurantId],
      );
      return r.rows[0].res;
    });
    expect(saved).toMatchObject({
      operating_mode: 'mode_a',
      pos_integration_name: 'Petpooja',
      webhook_configured: true,
    });

    // Owner can read restaurant_pos_integrations; cashier & kitchen see zero rows (RLS isolation)
    const ownerInteg = (
      await asUser(ownerId, () =>
        db.query(
          `select webhook_url, webhook_secret from restaurant_pos_integrations where restaurant_id = $1`,
          [restaurantId],
        ),
      )
    ).rows;
    expect(ownerInteg).toHaveLength(1);
    expect(ownerInteg[0].webhook_secret).toBe('sec-123');

    const cashierInteg = (
      await asUser(cashierId, () =>
        db.query(
          `select webhook_url, webhook_secret from restaurant_pos_integrations where restaurant_id = $1`,
          [restaurantId],
        ),
      )
    ).rows;
    expect(cashierInteg).toHaveLength(0);

    const kitchenInteg = (
      await asUser(kitchenId, () =>
        db.query(
          `select webhook_url, webhook_secret from restaurant_pos_integrations where restaurant_id = $1`,
          [restaurantId],
        ),
      )
    ).rows;
    expect(kitchenInteg).toHaveLength(0);

    // Create an order and verify kitchen role can read kot_handoff_* columns and mark entered_in_pos
    const orderRes = await asUser(cashierId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'dine_in', $2, $3::jsonb, null, null, null) as res`,
        [restaurantId, tableId, JSON.stringify([{ item_id: itemId, qty: 1 }])],
      );
      return r.rows[0].res;
    });

    const beforeHandoff = (
      await asUser(kitchenId, () =>
        db.query(`select kot_handoff_status, kot_handoff_at from orders where id = $1`, [
          orderRes.order_id,
        ]),
      )
    ).rows[0];
    expect(beforeHandoff.kot_handoff_status).toBe('pending');
    expect(beforeHandoff.kot_handoff_at).toBeNull();

    const handoffRes = await asUser(kitchenId, async () => {
      const r = await db.query(
        `select record_order_kot_handoff($1, 'entered_in_pos', 'POS-991') as res`,
        [orderRes.order_id],
      );
      return r.rows[0].res;
    });
    expect(handoffRes).toMatchObject({
      order_id: orderRes.order_id,
      kot_handoff_status: 'entered_in_pos',
      kot_handoff_ref: 'POS-991',
    });

    // Cross-tenant caller cannot update KOT handoff
    const outsiderId = randomUUID();
    await db.query(`insert into profiles(id) values ($1)`, [outsiderId]);
    await expect(
      asUser(outsiderId, () =>
        db.query(`select record_order_kot_handoff($1, 'entered_in_pos', 'X')`, [orderRes.order_id]),
      ),
    ).rejects.toThrow(/permission/i);
  }, 25000);

  it('Phase 1: deduplicates counter orders by idempotency key, recovers guest attempts, and logs immutable order_status_events', async () => {
    const slug = `p1-rel-${randomUUID().slice(0, 8)}`;
    const ownerId = randomUUID();
    const cashierId = randomUUID();
    const kitchenId = randomUUID();
    await db.query(`insert into profiles(id) values ($1), ($2), ($3)`, [ownerId, cashierId, kitchenId]);

    const restaurantId = (
      await db.query(
        `insert into restaurants(slug, name, tax_rate_bps, guest_verification_mode) values ($1, 'Reliability Cafe', 500, 'scan') returning id`,
        [slug],
      )
    ).rows[0].id;
    await db.query(
      `insert into memberships(restaurant_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'cashier'), ($1, $4, 'kitchen')`,
      [restaurantId, ownerId, cashierId, kitchenId],
    );

    const menuId = (
      await db.query(`insert into menus(restaurant_id, name, is_published) values ($1, 'Main', true) returning id`, [restaurantId])
    ).rows[0].id;
    const catId = (
      await db.query(`insert into categories(restaurant_id, menu_id, name) values ($1, $2, 'Mains') returning id`, [restaurantId, menuId])
    ).rows[0].id;
    const itemId = (
      await db.query(
        `insert into items(restaurant_id, category_id, name, price_paise, is_available) values ($1, $2, 'Dosa', 12000, true) returning id`,
        [restaurantId, catId],
      )
    ).rows[0].id;
    const tableId = (
      await db.query(`insert into dining_tables(restaurant_id, label) values ($1, 'T9') returning id`, [restaurantId])
    ).rows[0].id;

    // 1. Counter order idempotency: same key twice produces ONE order row and explicit deduplicated flag.
    const idemKey = randomUUID();
    const first = await asUser(cashierId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'dine_in', $2, $3::jsonb, null, null, null, $4::uuid) as res`,
        [restaurantId, tableId, JSON.stringify([{ item_id: itemId, qty: 2 }]), idemKey],
      );
      return r.rows[0].res;
    });
    expect(first.order_id).toBeTruthy();
    expect(first.code).toBeTruthy();
    expect(first.placed_at).toBeTruthy();
    expect(first.deduplicated).toBe(false);

    const replay = await asUser(cashierId, async () => {
      const r = await db.query(
        `select create_counter_order($1, 'dine_in', $2, $3::jsonb, null, null, null, $4::uuid) as res`,
        [restaurantId, tableId, JSON.stringify([{ item_id: itemId, qty: 2 }]), idemKey],
      );
      return r.rows[0].res;
    });
    expect(replay.order_id).toBe(first.order_id);
    expect(replay.code).toBe(first.code);
    expect(replay.deduplicated).toBe(true);

    const orderCount = (
      await db.query(`select count(*)::int as n from orders where restaurant_id = $1`, [restaurantId])
    ).rows[0].n;
    expect(orderCount).toBe(1);

    // 2. Order status events: placing, advancing prep status, and settling payment all emit immutable trace events.
    await asUser(kitchenId, () =>
      db.query(`update orders set prep_status = 'preparing' where id = $1`, [first.order_id]),
    );
    await asUser(cashierId, () =>
      db.query(`select record_counter_payment($1, $2, 'cash', $3, $4::uuid)`, [
        slug,
        first.order_id,
        first.total_paise,
        randomUUID(),
      ]),
    );

    const ownerEvents = (
      await asUser(ownerId, () =>
        db.query(
          `select event_type, from_status, to_status, actor_role from order_status_events where order_id = $1 order by created_at asc, id asc`,
          [first.order_id],
        ),
      )
    ).rows;
    expect(ownerEvents.map((e) => [e.event_type, e.from_status, e.to_status])).toEqual([
      ['placed', null, 'new'],
      ['prep_changed', 'new', 'preparing'],
      ['payment_changed', 'pending', 'paid'],
    ]);

    // Kitchen sees operational transitions, NEVER payment_changed events.
    const kitchenEvents = (
      await asUser(kitchenId, () =>
        db.query(
          `select event_type from order_status_events where order_id = $1 order by created_at asc`,
          [first.order_id],
        ),
      )
    ).rows;
    expect(kitchenEvents.map((e) => e.event_type)).toEqual(['placed', 'prep_changed']);

    // Events are immutable: UPDATE or DELETE is rejected.
    await expect(
      db.query(`delete from order_status_events where order_id = $1`, [first.order_id]),
    ).rejects.toThrow(/immutable/i);

    // 3. Guest attempt recovery: recover_public_order_by_attempt finds order by guest_token and never leaks across slugs.
    const guestAttempt = randomUUID();
    const tokenRow = (
      await db.query(`select public_token from table_qr_codes where table_id = $1`, [tableId])
    ).rows[0];
    const sessToken = (
      await db.query(`select * from open_table_session($1, $2)`, [tokenRow.public_token, 'b'.repeat(64)])
    ).rows[0].session_token;
    const placedCode = (
      await db.query(
        `select place_public_order($1, $2::jsonb, null, $3, $4::uuid, null) as code`,
        [slug, JSON.stringify([{ itemId, qty: 1 }]), sessToken, guestAttempt],
      )
    ).rows[0].code;

    const recovered = (
      await db.query(`select recover_public_order_by_attempt($1, $2::uuid) as res`, [slug, guestAttempt])
    ).rows[0].res;
    expect(recovered.found).toBe(true);
    expect(recovered.code).toBe(placedCode);
    expect(recovered.order_id).toBeTruthy();

    const wrongSlug = (
      await db.query(`select recover_public_order_by_attempt('other-slug', $1::uuid) as res`, [guestAttempt])
    ).rows[0].res;
    expect(wrongSlug).toEqual({ found: false });
  }, 25000);
});
