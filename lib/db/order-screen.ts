/**
 * One order, for the confirmation screen.
 *
 * Looked up by its code AND the restaurant slug. The code alone is guessable
 * enough that it should not be the only thing standing between a stranger and
 * someone's bill, so both have to match.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export type OrderScreenData = {
  code: string;
  restaurantName: string;
  /**
   * Which table the order is going to, or null for a counter order.
   *
   * This is the line the guest checks first: not a reference number, but
   * whether the kitchen knows where to bring the food. Null is a real answer
   * for a takeaway, and the screen says so rather than showing a blank.
   */
  tableLabel: string | null;
  prepStatus: string;
  paymentStatus: string;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  customerNote: string | null;
  placedAt: string;
  lines: {
    name: string;
    qty: number;
    unitPricePaise: number;
    lineTotalPaise: number;
    isVeg: boolean;
  }[];
};

export async function getOrderScreenData(
  slug?: string,
  code?: string
): Promise<OrderScreenData | null> {
  if (!isSupabaseConfigured) return null;
  if (!slug?.trim() || !code?.trim()) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, name')
    .eq('slug', slug.trim())
    .eq('is_active', true)
    .maybeSingle();

  if (restaurantError) throw new Error(`Could not load restaurant: ${restaurantError.message}`);
  if (!restaurant) return null;

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'id, code, table_id, prep_status, payment_status, subtotal_paise, tax_paise, total_paise, customer_note, placed_at'
    )
    .eq('restaurant_id', restaurant.id)
    .eq('code', code.trim())
    .maybeSingle();

  if (orderError) throw new Error(`Could not load the order: ${orderError.message}`);
  if (!order) return null;

  // Separate query rather than an embed: the hand-written Database type does
  // not describe this relationship, so order_items(*) does not typecheck.
  const { data: rows, error: itemsError } = await supabase
    .from('order_items')
    .select('name_snapshot, qty, unit_price_paise, is_veg, sort_order')
    .eq('order_id', order.id as string)
    .order('sort_order', { ascending: true });

  if (itemsError) throw new Error(`Could not load the order: ${itemsError.message}`);

  // A separate lookup rather than an embed, for the same reason as the items:
  // the hand-written Database type does not describe dining_tables on orders.
  const tableId = (order.table_id as string | null) ?? null;
  let tableLabel: string | null = null;

  if (tableId) {
    const { data: table } = await supabase
      .from('dining_tables')
      .select('label')
      .eq('id', tableId)
      .maybeSingle();

    tableLabel = ((table?.label as string | undefined) ?? null) || null;
  }

  return {
    code: order.code as string,
    restaurantName: (restaurant.name as string) ?? 'Your table',
    tableLabel,
    prepStatus: order.prep_status as string,
    paymentStatus: order.payment_status as string,
    subtotalPaise: Number(order.subtotal_paise ?? 0),
    taxPaise: Number(order.tax_paise ?? 0),
    totalPaise: Number(order.total_paise ?? 0),
    customerNote: (order.customer_note as string | null) ?? null,
    placedAt: order.placed_at as string,
    lines: (rows ?? []).map((r) => ({
      // The snapshot, not the item's current name: this reads as it was served.
      name: (r.name_snapshot as string) ?? '',
      qty: Number(r.qty ?? 0),
      unitPricePaise: Number(r.unit_price_paise ?? 0),
      lineTotalPaise: Number(r.unit_price_paise ?? 0) * Number(r.qty ?? 0),
      isVeg: Boolean(r.is_veg),
    })),
  };
}
