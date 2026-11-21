/**
 * Load the counter queue: orders still awaiting payment, plus counter POS
 * quick-entry catalog, tables, and settled payments for manager/owner refunds.
 */

import { getStaffContextDetailed } from '@/lib/db/staff';
import { clockTimeInZone } from './time';

export { COUNTER_METHODS, SPLIT_METHODS, isCounterMethod, isSplitMethod } from '@/lib/payment-methods';
export type { CounterMethod, SplitMethod } from '@/lib/payment-methods';

import { paiseToRupees } from '@/lib/money';
import type { MemberRole } from '@/lib/db/database';
import type { OrderChannel } from '@/lib/db/types';

export type CounterPaymentEntry = {
  id: string;
  method: string;
  amountPaise: number;
  splitLabel: string | null;
  status: string;
  recordedAt: string;
};

export type CounterOrder = {
  id?: string;
  code: string;
  table: string;
  channel?: OrderChannel;
  at: string;
  state: string;
  total: number;
  outstanding: number;
  paid: number;
  items: string;
  pendingOnline: boolean;
  /** Billing Spec v2.0 breakdown in integer paise. */
  subtotalPaise?: number;
  discountPaise?: number;
  discountReason?: string | null;
  isComplimentary?: boolean;
  serviceChargePaise?: number;
  packagingChargePaise?: number;
  deliveryChargePaise?: number;
  roundOffPaise?: number;
  taxPaise?: number;
  totalPaise?: number;
  paidPaise?: number;
  outstandingPaise?: number;
  recordedPayments?: CounterPaymentEntry[];
};

export type CounterMenuOption = {
  id: string;
  name: string;
  pricePaise: number;
  variants: Array<{ id: string; name: string; pricePaise: number }>;
};

export type CounterTableOption = {
  id: string;
  label: string;
};

export type RefundablePayment = {
  paymentId: string;
  orderId: string;
  orderCode: string;
  table: string;
  method: string;
  amountPaise: number;
  refundedPaise: number;
  refundablePaise: number;
  at: string;
};

export type CashierScreenData = {
  restaurantName: string;
  role?: MemberRole;
  queue: CounterOrder[];
  tables?: CounterTableOption[];
  menuItems?: CounterMenuOption[];
  refundablePayments?: RefundablePayment[];
  blocked?: 'signed-out' | 'no-membership';
};

export const QUEUE_WINDOW_HOURS = 24;

const NO_TABLE = 'Takeaway';

const PREP_LABEL: Record<string, string> = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  cancelled: 'Cancelled',
};

function channelLabel(channel: string | null | undefined): string {
  if (channel === 'delivery') return 'Delivery';
  if (channel === 'takeaway') return 'Takeaway';
  return NO_TABLE;
}

export async function getCashierScreenData(): Promise<CashierScreenData | null> {
  const staff = await getStaffContextDetailed();

  if (!staff.ok) {
    if (staff.reason === 'unconfigured') return null;
    return { restaurantName: '', queue: [], blocked: staff.reason };
  }

  const { supabase, restaurantId, restaurantName, timezone, role } = staff.context;
  const cutoff = new Date(Date.now() - QUEUE_WINDOW_HOURS * 3_600_000).toISOString();

  type FinanceOrderRow = {
    id: string;
    code: string;
    table_id: string | null;
    prep_status: string;
    total_paise: number;
    placed_at: string;
    order_channel?: OrderChannel;
    subtotal_paise?: number;
    discount_paise?: number;
    discount_reason?: string | null;
    is_complimentary?: boolean;
    service_charge_paise?: number;
    packaging_charge_paise?: number;
    delivery_charge_paise?: number;
    round_off_paise?: number;
    tax_paise?: number;
  };

  let rows: FinanceOrderRow[] = [];
  const fullOrders = await supabase
    .from('orders_finance')
    .select(
      'id, code, table_id, prep_status, subtotal_paise, discount_paise, discount_reason, is_complimentary, service_charge_paise, packaging_charge_paise, delivery_charge_paise, round_off_paise, tax_paise, total_paise, placed_at, order_channel',
    )
    .eq('restaurant_id', restaurantId)
    .eq('payment_status', 'pending')
    .neq('prep_status', 'cancelled')
    .gte('placed_at', cutoff)
    .order('placed_at', { ascending: true });

  if (fullOrders.error) {
    // Graceful fallback when connected to a pre-v2 database where orders_finance lacks v2 columns.
    const msg = fullOrders.error.message.toLowerCase();
    if (msg.includes('column') && msg.includes('does not exist')) {
      const legacyOrders = await supabase
        .from('orders_finance')
        .select('id, code, table_id, prep_status, total_paise, placed_at')
        .eq('restaurant_id', restaurantId)
        .eq('payment_status', 'pending')
        .neq('prep_status', 'cancelled')
        .gte('placed_at', cutoff)
        .order('placed_at', { ascending: true });
      if (legacyOrders.error) {
        throw new Error(`Could not load orders: ${legacyOrders.error.message}`);
      }
      rows = (legacyOrders.data ?? []) as FinanceOrderRow[];
    } else {
      throw new Error(`Could not load orders: ${fullOrders.error.message}`);
    }
  } else {
    rows = (fullOrders.data ?? []) as FinanceOrderRow[];
  }

  // Load tables and active menu items for counter POS quick-order entry in parallel.
  const [tablesAllResult, itemsCatalogResult, variantsResult] = await Promise.all([
    supabase
      .from('dining_tables')
      .select('id, label')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .order('label', { ascending: true }),
    supabase
      .from('items')
      .select('id, name, price_paise')
      .eq('restaurant_id', restaurantId)
      .eq('is_available', true)
      .order('sort_order', { ascending: true })
      .limit(120),
    supabase.from('item_variants').select('id, item_id, name, price_paise').order('sort_order', { ascending: true }),
  ]);

  const tables: CounterTableOption[] = (tablesAllResult.data ?? []).map((t) => ({
    id: t.id,
    label: t.label,
  }));
  const labelByTable = new Map<string, string>(tables.map((t) => [t.id, t.label]));

  const variantsByItem = new Map<string, Array<{ id: string; name: string; pricePaise: number }>>();
  for (const v of variantsResult.data ?? []) {
    const list = variantsByItem.get(v.item_id) ?? [];
    list.push({ id: v.id, name: v.name, pricePaise: v.price_paise });
    variantsByItem.set(v.item_id, list);
  }
  const menuItems: CounterMenuOption[] = (itemsCatalogResult.data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    pricePaise: i.price_paise,
    variants: variantsByItem.get(i.id) ?? [],
  }));

  // Load recent recorded & refunded payments for Owner/Manager refund window (last 24h).
  let refundablePayments: RefundablePayment[] = [];
  if (role === 'owner' || role === 'manager') {
    const paidOrdersRes = await supabase
      .from('orders_finance')
      .select('id, code, table_id, placed_at')
      .eq('restaurant_id', restaurantId)
      .eq('payment_status', 'paid')
      .gte('placed_at', cutoff)
      .order('placed_at', { ascending: false })
      .limit(30);
    const paidOrders = paidOrdersRes.data ?? [];
    if (paidOrders.length > 0) {
      const paidOrderIds = paidOrders.map((o) => o.id);
      const orderById = new Map(paidOrders.map((o) => [o.id, o]));
      const payRes = await supabase
        .from('payments')
        .select('id, order_id, method, amount_paise, status, created_at, refund_of_payment_id')
        .in('order_id', paidOrderIds)
        .order('created_at', { ascending: false });
      if (!payRes.error) {
        const payRows = (payRes.data ?? []) as Array<{
          id: string;
          order_id: string;
          method: string;
          amount_paise: number;
          status: string;
          created_at: string;
          refund_of_payment_id?: string | null;
        }>;
        const refundedByOriginal = new Map<string, number>();
        for (const p of payRows) {
          if (p.status === 'refunded' && p.refund_of_payment_id) {
            refundedByOriginal.set(
              p.refund_of_payment_id,
              (refundedByOriginal.get(p.refund_of_payment_id) ?? 0) + p.amount_paise,
            );
          }
        }
        refundablePayments = payRows
          .filter((p) => p.status === 'recorded')
          .map((p) => {
            const ord = orderById.get(p.order_id);
            const refundedPaise = refundedByOriginal.get(p.id) ?? 0;
            const refundablePaise = Math.max(p.amount_paise - refundedPaise, 0);
            return {
              paymentId: p.id,
              orderId: p.order_id,
              orderCode: ord?.code ?? '—',
              table: (ord?.table_id && labelByTable.get(ord.table_id)) || NO_TABLE,
              method: p.method,
              amountPaise: p.amount_paise,
              refundedPaise,
              refundablePaise,
              at: clockTimeInZone(timezone, p.created_at),
            };
          })
          .filter((p) => p.refundablePaise > 0);
      }
    }
  }

  if (rows.length === 0) {
    return { restaurantName, role, queue: [], tables, menuItems, refundablePayments };
  }

  const orderIds = rows.map((row) => row.id);
  const missingTableIds = [
    ...new Set(rows.map((r) => r.table_id).filter((id): id is string => Boolean(id && !labelByTable.has(id)))),
  ];

  const [itemsResult, extraTablesResult, paymentsResult] = await Promise.all([
    supabase
      .from('order_items')
      .select('order_id, qty, name_snapshot, sort_order')
      .in('order_id', orderIds)
      .order('sort_order', { ascending: true }),
    missingTableIds.length
      ? supabase.from('dining_tables').select('id, label').in('id', missingTableIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('payments')
      .select('id, order_id, amount_paise, status, method, created_at')
      .in('order_id', orderIds),
  ]);

  if (itemsResult.error) {
    throw new Error(`Could not load order items: ${itemsResult.error.message}`);
  }
  if (extraTablesResult.error) {
    throw new Error(`Could not load tables: ${extraTablesResult.error.message}`);
  }
  if (paymentsResult.error) {
    throw new Error(`Could not load payments: ${paymentsResult.error.message}`);
  }

  for (const table of extraTablesResult.data ?? []) {
    labelByTable.set(table.id, table.label);
  }

  const pendingOnlineByOrder = new Set<string>();
  const paidByOrder = new Map<string, number>();
  const recordedPaymentsByOrder = new Map<string, CounterPaymentEntry[]>();
  for (const p of paymentsResult.data ?? []) {
    if (p.status === 'pending' && p.method === 'online') pendingOnlineByOrder.add(p.order_id);
    if (p.status !== 'recorded') continue;
    paidByOrder.set(p.order_id, (paidByOrder.get(p.order_id) ?? 0) + p.amount_paise);
    const list = recordedPaymentsByOrder.get(p.order_id) ?? [];
    list.push({
      id: p.id,
      method: p.method,
      amountPaise: p.amount_paise,
      splitLabel: null,
      status: p.status,
      recordedAt: clockTimeInZone(timezone, p.created_at),
    });
    recordedPaymentsByOrder.set(p.order_id, list);
  }

  const itemsByOrder = new Map<string, typeof itemsResult.data>();
  for (const item of itemsResult.data ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  const queue: CounterOrder[] = rows.map((row) => {
    const lines = (itemsByOrder.get(row.id) ?? []).map((item) => `${item.qty} × ${item.name_snapshot}`);
    const paidPaise = Math.min(paidByOrder.get(row.id) ?? 0, row.total_paise);
    const outstandingPaise = Math.max(row.total_paise - (paidByOrder.get(row.id) ?? 0), 0);

    return {
      id: row.id,
      code: row.code,
      table: (row.table_id && labelByTable.get(row.table_id)) || channelLabel(row.order_channel),
      channel: row.order_channel ?? (row.table_id ? 'dine_in' : 'takeaway'),
      at: clockTimeInZone(timezone, row.placed_at),
      state: PREP_LABEL[row.prep_status] ?? row.prep_status,
      total: paiseToRupees(row.total_paise),
      paid: paiseToRupees(paidPaise),
      outstanding: paiseToRupees(outstandingPaise),
      items: lines.join(' · ') || 'No items recorded',
      pendingOnline: pendingOnlineByOrder.has(row.id),
      subtotalPaise: row.subtotal_paise ?? row.total_paise,
      discountPaise: row.discount_paise ?? 0,
      discountReason: row.discount_reason ?? null,
      isComplimentary: row.is_complimentary === true,
      serviceChargePaise: row.service_charge_paise ?? 0,
      packagingChargePaise: row.packaging_charge_paise ?? 0,
      deliveryChargePaise: row.delivery_charge_paise ?? 0,
      roundOffPaise: row.round_off_paise ?? 0,
      taxPaise: row.tax_paise ?? 0,
      totalPaise: row.total_paise,
      paidPaise,
      outstandingPaise,
      recordedPayments: recordedPaymentsByOrder.get(row.id) ?? [],
    };
  });

  return { restaurantName, role, queue, tables, menuItems, refundablePayments };
}
