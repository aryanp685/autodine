'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseCart } from '@/lib/cart-storage';
import { loadTableAccess } from '@/lib/table-access';

const CART_PATH = '/menu/cart';

/**
 * Back to the cart with a sentence the guest can act on.
 *
 * THE SLUG IS NOT OPTIONAL
 *
 * This redirected to a bare /menu/cart for its whole life, and the slug is what
 * the cart is keyed by -- the localStorage entry, the restaurant it belongs to,
 * the table session that has to still be live. So every failed order sent the
 * guest to a page that believed their cart was empty, next to a message saying
 * the order had failed. A guest reads that as "my order vanished", which is
 * worse than the failure itself: the cart was in their browser the whole time,
 * under a key the redirected page never asked for.
 *
 * The cart page reads `s` and gates on it, so dropping it also dropped the
 * table gate. Passing it through fixes both at once.
 */
function fail(message: string, slug?: string): never {
  const query = new URLSearchParams({ error: message });
  if (slug) query.set('s', slug);
  redirect(`${CART_PATH}?${query.toString()}`);
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
  if (lines.length === 0) fail('Your cart is empty.', slug);

  const note = String(formData.get('note') ?? '').trim().slice(0, 300) || null;

  // Arriving by QR means the order belongs to a table, and the table is what
  // the kitchen calls out. The session is passed rather than a table number
  // the browser could have typed: the database resolves the table from it.
  //
  // THIS IS NOW REQUIRED, AND THE DATABASE IS ASKED
  //
  // An expired session used to be dropped and the order placed as a counter
  // order -- a "clock should not lose a sale" decision that also meant anyone
  // holding a cart could order from anywhere. place_public_order now raises
  // without a table session, so this cannot quietly fall back even if this
  // line were wrong; the check here exists so the guest gets a sentence they
  // can act on instead of a Postgres error, and so a guest whose hour ran out
  // is sent back to the code form rather than left staring at a cart.
  const access = await loadTableAccess(slug);

  if (access.status === 'stale' && access.qrToken) {
    // One tap back to the card's form. The cart lives in localStorage, so
    // nothing is lost by leaving the page.
    redirect(`/t/${access.qrToken}`);
  }

  if (access.status === 'stale') {
    fail('Your table session has ended. Scan the QR code on your table and enter the current code to order.', slug);
  }
  if (access.status === 'none') {
    fail('This menu takes orders from a table. Scan the QR code on your table and enter the code showing inside the restaurant.', slug);
  }
  if (access.status === 'unavailable') {
    fail('We could not check your table just now. Please try again, or order with staff.', slug);
  }
  if (access.status !== 'verified') {
    fail('This menu takes orders from a table. Please scan the QR code on your table.', slug);
  }

  const liveSession = access.session.token;

  // The guest's own key to this order, made here and never shown to anyone
  // else. It goes into the redirect that follows, which is what lets the
  // confirmation screen read, change and cancel the order without a login.
  // The order code cannot do that job: it is short, it is read out at the
  // counter, and a page that opened on a guessed code would show a stranger's
  // bill.
  const guestToken = crypto.randomUUID();

  const { data: code, error } = await supabase.rpc('place_public_order', {
    p_slug: slug,
    p_lines: lines,
    p_note: note,
    p_session_token: liveSession,
    p_guest_token: guestToken,
  });

  if (error) {
    // Every branch that reaches a guest is logged with its code. Without this
    // an "unexpected failure" was untraceable from the server: the guest saw
    // one fixed sentence and the log carried nothing to search for.
    console.error('[placeOrderAction] place_public_order failed', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });

    // A missing function or a missing column is a deployment problem, not a
    // guest problem, and "please try again" sends them round the same loop.
    // Supabase answers PGRST202/PGRST203 when the RPC is not in the schema
    // cache -- i.e. the migration that defines it has not been applied here.
    if (error.code === 'PGRST202' || error.code === 'PGRST203') {
      fail(
        'Ordering is not switched on for this restaurant yet. Please ask a member of staff to take your order.',
        slug
      );
    }
    if (error.code === '42501') {
      fail('Ordering is not switched on for this restaurant yet. Please order with staff.', slug);
    }
    if (error.code === '42883' || error.code === '42P01' || error.code === '42703') {
      fail(
        'This restaurant is still being set up, so the order could not be placed. Please order with staff.',
        slug
      );
    }

    // The function raises P0001 for the failures a customer can cause --
    // empty cart, sold out, wrong restaurant -- and its messages are written
    // to be read by a customer, so those pass straight through.
    //
    // Anything else is not. A permission error or a constraint violation
    // would leak the shape of the database into an error banner, so those
    // become one fixed sentence and the detail goes to the server log.
    if (error.code === 'P0001') {
      fail(error.message, slug);
    }
    fail('We could not place that order. Please try again.', slug);
  }

  if (typeof code !== 'string' || code === '') {
    console.error('[placeOrderAction] function returned no code', code);
    fail('We could not place that order. Please try again.', slug);
  }

  redirect(
    `/menu/order?s=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}&t=${guestToken}`
  );
}
