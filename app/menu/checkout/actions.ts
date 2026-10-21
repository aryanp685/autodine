'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { computeOrderTotals } from '@/lib/pricing';
import { parseCart } from '@/lib/cart-storage';

const CART_PATH = '/menu/cart';

function fail(message: string): never {
  redirect(`${CART_PATH}?error=${encodeURIComponent(message)}`);
}

/**
 * Turn a cart into an order.
 *
 * The browser sends item ids and quantities. That is all it is allowed to
 * send. Every price on the order is read from the database here, at the moment
 * the order is written -- the same numbers the customer saw on the menu, and
 * not numbers they could have edited on the way.
 *
 * The order lands as `prep_status = 'new'` so it appears on the kitchen screen
 * immediately, and `payment_status = 'pending'` because online payment is not
 * connected yet and the customer pays at the counter.
 */
export async function placeOrderAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) fail('Ordering is not available right now.');

  const slug = String(formData.get('slug') ?? '').trim();
  if (!slug) fail('We lost track of which restaurant this is for. Open the menu again.');

  // The cart is the customer's to edit, so it is read as untrusted input.
  const lines = parseCart(String(formData.get('lines') ?? ''));
  if (lines.length === 0) fail('Your cart is empty.');

  const note = String(formData.get('note') ?? '').trim().slice(0, 300) || null;

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, name')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (restaurantError || !restaurant) {
    fail('That restaurant is not taking orders right now.');
  }

  // Scoped to this restaurant. An id belonging to another kitchen simply does
  // not come back, so a cart cannot be used to order someone else's food.
  const { data: rows, error: itemsError } = await supabase
    .from('items')
    .select('id, name, price_paise, is_veg, is_available')
    .eq('restaurant_id', restaurant.id)
    .in(
      'id',
      lines.map((l) => l.itemId)
    );

  if (itemsError) fail(`Could not load the menu: ${itemsError.message}`);

  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));

  const ordered: { id: string; name: string; pricePaise: number; isVeg: boolean; qty: number }[] =
    [];
  for (const line of lines) {
    const item = byId.get(line.itemId);
    // Gone from the menu, or sold out since the cart was filled. Skipped
    // rather than failed: one stale line should not lose the whole order.
    if (!item || !item.is_available) continue;
    ordered.push({
      id: item.id as string,
      name: item.name as string,
      pricePaise: Number(item.price_paise ?? 0),
      isVeg: Boolean(item.is_veg),
      qty: line.qty,
    });
  }

  if (ordered.length === 0) {
    fail('None of those items are available right now.');
  }

  const totals = computeOrderTotals({
    lines: ordered.map((l) => ({ unitPricePaise: l.pricePaise, qty: l.qty })),
  });

  // The database enforces total = subtotal - discount + tax. If that ever
  // stops holding it is a bug in the arithmetic, and it is better to say so
  // than to let the insert fail with a message about a constraint.
  const expected = totals.subtotalPaise - totals.discountPaise + totals.taxPaise;
  if (totals.totalPaise !== expected) {
    throw new Error(
      `Order totals do not add up: ${totals.totalPaise} != ${expected}. Refusing to write the order.`
    );
  }

  const code = orderCode(restaurant.name as string);

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      restaurant_id: restaurant.id,
      code,
      customer_note: note,
      prep_status: 'new',
      payment_status: 'pending',
      subtotal_paise: totals.subtotalPaise,
      discount_paise: totals.discountPaise,
      tax_paise: totals.taxPaise,
      total_paise: totals.totalPaise,
    })
    .select('id')
    .single();

  if (orderError || !order) {
    fail(`Could not place the order: ${orderError?.message ?? 'the kitchen did not accept it'}`);
  }

  const { error: lineError } = await supabase.from('order_items').insert(
    ordered.map((l, i) => ({
      order_id: order.id as string,
      item_id: l.id,
      // The snapshot is what makes history safe. If the dish is renamed or
      // repriced tomorrow, this order still reads as it was served.
      name_snapshot: l.name,
      unit_price_paise: l.pricePaise,
      qty: l.qty,
      addons_snapshot: [],
      is_veg: l.isVeg,
      sort_order: i,
    }))
  );

  if (lineError) {
    // The order exists but is empty, which would show the kitchen a ticket
    // with nothing on it. Take it back rather than leaving a ghost.
    await supabase.from('orders').delete().eq('id', order.id as string);
    fail(`Could not place the order: ${lineError.message}`);
  }

  redirect(`/menu/order?s=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}`);
}

/**
 * A short code the pass can call out, e.g. "MA-K3F9Q".
 *
 * There is no unique constraint on it, so it has to be long enough that two
 * open tickets never share one. Five base-36 characters is sixty million
 * combinations; at pilot volumes a collision is not a realistic outcome.
 */
function orderCode(restaurantName: string): string {
  const letters = restaurantName.replace(/[^a-zA-Z]/g, '').toUpperCase();
  const prefix = (letters.slice(0, 2) || 'AD').padEnd(2, 'D');
  const suffix = randomUUID().replace(/-/g, '').slice(0, 5).toUpperCase();
  return `${prefix}-${suffix}`;
}
