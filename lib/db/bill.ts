/**
 * One bill, read for printing.
 *
 * A bill is a record, not a recomputation. Every figure here comes from the
 * order row -- the same numbers the guest was charged -- so printing a bill
 * months later cannot produce a different total because the tax rate or a
 * dish price changed in between. The ticket is not a GST document.
 *
 * WHO CAN SEE IT
 * Finance staff of this outlet only. This reads ticket and payment amounts;
 * it never pulls the live GST registration onto a historical ticket.
 *
 * A misconfigured or signed-out caller is told apart from a missing order, so
 * the screen can say "sign in" instead of "no such bill".
 */

import { dbErrorReference } from '@/lib/db/error-reference';
import { CASHIER_ROLES, getStaffContextDetailed } from '@/lib/db/staff';
import { billLineLabel, billTaxRateBps, type BillData, type BillLine, type BillPayment } from '@/lib/bill';

// The bill's shape and its wording live in lib/bill.ts, which has no server
// imports: the bill screen is a client component and must not pull
// next/headers into the browser bundle. Re-exported here so staff-side code
// has one place to import from.
export type { BillData, BillLine, BillPayment } from '@/lib/bill';

export type BillResult =
  | { ok: true; bill: BillData }
  | { ok: false; reason: 'unconfigured' | 'signed-out' | 'no-membership' | 'not-found' };

function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export async function getBillData(orderId: string): Promise<BillResult> {
  if (!orderId) return { ok: false, reason: 'not-found' };

  const staff = await getStaffContextDetailed();
  if (!staff.ok) return { ok: false, reason: staff.reason };

  const { supabase, restaurantId, timezone, role } = staff.context;
  if (!CASHIER_ROLES.includes(role)) return { ok: false, reason: 'not-found' };

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('name, address, phone')
    .eq('id', restaurantId)
    .maybeSingle();

  if (restaurantError) {
    throw new Error(`Could not load the restaurant: ${dbErrorReference(restaurantError)}`);
  }

  const { data: order, error: orderError } = await supabase
    .from('orders_finance')
    .select(
      'id, code, table_id, customer_note, prep_status, payment_status, subtotal_paise, discount_paise, tax_paise, total_paise, placed_at, tax_rate_bps_snapshot, gst_mode_snapshot'
    )
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (orderError) throw new Error(`Could not load the order: ${dbErrorReference(orderError)}`);
  if (!order) return { ok: false, reason: 'not-found' };

  const [itemsResult, paymentsResult, tableResult] = await Promise.all([
    supabase
      .from('order_items_finance')
      .select('id, qty, name_snapshot, variant_snapshot, addons_snapshot, unit_price_paise, is_veg, sort_order')
      .eq('order_id', order.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('payments')
      .select('method, amount_paise, status, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: true }),
    order.table_id
      ? supabase.from('dining_tables').select('label').eq('id', order.table_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (itemsResult.error) throw new Error(`Could not load the bill lines: ${dbErrorReference(itemsResult.error)}`);
  if (paymentsResult.error) throw new Error(`Could not load payments: ${dbErrorReference(paymentsResult.error)}`);
  if (tableResult.error) throw new Error(`Could not load the table: ${dbErrorReference(tableResult.error)}`);

  // Only money that actually moved. A failed or refunded attempt is not part
  // of what the guest has paid, and a pending one has not been collected yet.
  const payments: BillPayment[] = (paymentsResult.data ?? [])
    .filter((p) => p.status === 'recorded')
    .map((p) => ({
      method: p.method,
      amountPaise: p.amount_paise,
      at: formatWhen(p.created_at, timezone),
    }));

  const paidPaise = payments.reduce((sum, p) => sum + p.amountPaise, 0);
  const outstandingPaise = Math.max(0, order.total_paise - paidPaise);

  const lines: BillLine[] = (itemsResult.data ?? []).map((item) => ({
    id: item.id,
    label: billLineLabel({
      name: item.name_snapshot,
      variant: item.variant_snapshot,
      addons: item.addons_snapshot ?? [],
    }),
    qty: item.qty,
    ratePaise: item.unit_price_paise,
    amountPaise: item.unit_price_paise * item.qty,
    isVeg: item.is_veg,
  }));

  return {
    ok: true,
    bill: {
      restaurant: {
        name: restaurant?.name ?? staff.context.restaurantName,
        address: restaurant?.address ?? null,
        phone: restaurant?.phone ?? null,
      },
      order: {
        id: order.id,
        code: order.code,
        placedAt: formatWhen(order.placed_at, timezone),
        tableLabel: tableResult.data?.label ?? null,
        prepStatus: order.prep_status,
        paymentStatus: order.payment_status,
        cancelled: order.prep_status === 'cancelled',
        customerNote: order.customer_note,
        subtotalPaise: order.subtotal_paise,
        discountPaise: order.discount_paise,
        taxPaise: order.tax_paise,
        totalPaise: order.total_paise,
        gstMode: order.gst_mode_snapshot ?? 'off',
        // No snapshot means the order predates migration 00600. The bill then
        // says nothing about a rate rather than guessing one -- see
        // billTaxRateBps and how BillScreen renders a null rate.
        taxRateBps: billTaxRateBps(
          order.tax_rate_bps_snapshot,
          order.tax_paise,
          Math.max(0, order.subtotal_paise - order.discount_paise)
        ),
      },
      lines,
      payments,
      outstandingPaise,
    },
  };
}
