'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseCart } from '@/lib/cart-storage';
import { isExpired, readTableSession } from '@/lib/table-session';

const CART_PATH = '/menu/cart';

function fail(message: string): never {
  redirect(`${CART_PATH}?error=${encodeURIComponent(message)}`);
}

/**
 * Turn a cart into an order.
 *
 * The browser sends item ids and quantities. That is all it is allowed to
 * send. Every price on the order is read inside the database, by
 * public.place_public_order(), at the moment the order is written.
 *
 * Why the write lives in the database rather than here: the orders and
 * order_items tables have no INSERT policy for anonymous callers, and under
 * row level security a missing policy means denied. They have no such policy
 * on purpose. An INSERT policy can only inspect the row being written, so a
 * guest could name their own unit_price_paise, or attach lines to somebody
 * else's order. A function can check the things that actually matter --
 * which restaurant, which published menu, what the dish really costs -- and
 * do the whole write in one transaction.
 *
 * This file is therefore only the front door. It parses what the browser
 * sent, hands it over, and decides where the customer lands next.
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

  // Arriving by QR means the order belongs to a table, and the table is what
  // the kitchen calls out. The session is passed rather than a table number
  // the browser could have typed: the database resolves the table from it.
  //
  // An expired session is dropped rather than failed. The order still goes
  // through as a counter order, which is a real thing a guest standing at a
  // counter does, and refusing it outright would lose a sale over a clock.
  const session = await readTableSession();
  const liveSession =
    session && !isExpired(session) && session.slug === slug ? session.token : null;

  const { data: code, error } = await supabase.rpc('place_public_order', {
    p_slug: slug,
    p_lines: lines,
    p_note: note,
    p_session_token: liveSession,
  });

  if (error) {
    // The function raises P0001 for the failures a customer can cause --
    // empty cart, sold out, wrong restaurant -- and its messages are written
    // to be read by a customer, so those pass straight through.
    //
    // Anything else is not. A permission error or a constraint violation
    // would leak the shape of the database into an error banner, so those
    // become one fixed sentence and the detail goes to the server log.
    if (error.code === 'P0001') {
      fail(error.message);
    }
    console.error('[placeOrderAction] unexpected failure', error);
    fail('We could not place that order. Please try again.');
  }

  if (typeof code !== 'string' || code === '') {
    console.error('[placeOrderAction] function returned no code', code);
    fail('We could not place that order. Please try again.');
  }

  redirect(`/menu/order?s=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}`);
}
