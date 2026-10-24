'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseCart } from '@/lib/cart-storage';
import { codePageHref, loadTableAccess } from '@/lib/table-access';
import {
  describePlaceFailure,
  isTransientPlaceCode,
} from '@/lib/place-order-failure';

const CART_PATH = '/menu/cart';

/**
 * How long to wait before each retry of a failure that wrote nothing.
 *
 * Two seconds in total, and only for the classes that say "the database was not
 * reachable right now" (see isTransientPlaceCode). A schema-cache reload after
 * a database restart answers PGRST002 for a second or two, which is longer than
 * a single 350 ms wait; a guest waiting two seconds for a placed order is better
 * than a guest told to tap the button again.
 */
const TRANSIENT_RETRY_WAITS_MS = [400, 1200];

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
function fail(message: string, slug?: string, code?: string): never {
  const query = new URLSearchParams({ error: message });
  if (slug) query.set('s', slug);
  /**
   * A failure nobody has classified yet says what class it was.
   *
   * Every branch below that a guest can cause has its own sentence. What is
   * left is the unknown, and an unknown used to render one fixed sentence with
   * nothing to search for -- which is how a demo died in front of an owner
   * with no way to tell whether the database, the deploy or the wifi was at
   * fault. The SQLSTATE (five characters, e.g. 23502) is not the database's
   * shape; it is the class of refusal. It costs a guest nothing to read and it
   * turns "please try again" into a fact somebody can act on.
   */
  if (code) query.set('code', code);
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

  /**
   * A guest who scanned a live card but has not entered the code yet.
   *
   * This is the expected case now, not an error: browsing is open, ordering is
   * not, and the code form is one screen away with the cart untouched. The
   * `next` names the checkout so the code lands them back on it, and
   * safeNextPath narrows it to a path this app knows before anything is
   * redirected to.
   */
  if (access.status === 'browse') {
    const back = `/menu/checkout?s=${encodeURIComponent(slug)}`;
    redirect(`${codePageHref(access.qrToken)}?next=${encodeURIComponent(back)}`);
  }

  if (access.status === 'stale' && access.qrToken) {
    // One tap back to the code form. The cart lives in localStorage, so
    // nothing is lost by leaving the page.
    const back = `/menu/checkout?s=${encodeURIComponent(slug)}`;
    redirect(`${codePageHref(access.qrToken)}?next=${encodeURIComponent(back)}`);
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
  /**
   * The attempt key, when the browser sent one.
   *
   * It is a UUID or nothing: a value that is not one is replaced rather than
   * forwarded, so the database never has to reason about a caller-controlled
   * string, and a guest who re-posts the same form gets the order the first
   * post wrote instead of a second one. See migration 20261027000900 for the
   * other half -- the function returns the existing code for a key it has
   * already used.
   */
  const attempt = String(formData.get('attempt') ?? '').trim();
  const guestToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attempt)
    ? attempt
    : crypto.randomUUID();

  let { data: code, error } = await supabase.rpc('place_public_order', {
    p_slug: slug,
    p_lines: lines,
    p_note: note,
    p_session_token: liveSession,
    p_guest_token: guestToken,
  });

  /**
   * One more try, but only for failures that prove nothing was written.
   *
   * A free-tier database answers PGRST002 while its schema cache reloads after a
   * restart, PGRST003 when the connection pool is momentarily full, and 57P01
   * when the server is being recycled. All of these abort before the order is
   * written, so a second call cannot produce a second order -- and the guest's
   * only alternative is to tap Place order again and hope, which is what this
   * whole screen exists to avoid. A lost response (the connection dropping after
   * a commit) is a thrown fetch error, not one of these codes, and is not
   * retried.
   */
  for (const waitMs of TRANSIENT_RETRY_WAITS_MS) {
    if (!isTransientPlaceCode(error?.code)) break;

    console.warn('[placeOrderAction] transient failure, retrying', {
      code: error?.code,
      inMs: waitMs,
    });
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    const retry = await supabase.rpc('place_public_order', {
      p_slug: slug,
      p_lines: lines,
      p_note: note,
      p_session_token: liveSession,
      p_guest_token: guestToken,
    });
    code = retry.data;
    error = retry.error;
  }

  if (error) {
    // Every branch that reaches a guest is logged with its code. Without this
    // an "unexpected failure" was untraceable from the server: the guest saw
    // one fixed sentence and the log carried nothing to search for.
    console.error('[placeOrderAction] place_public_order failed', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      // What was being asked, without the guest's session token or the note.
      // A failure that says "more than one row" is only actionable next to
      // the request that produced it: which restaurant, how many lines, and
      // whether the ordering came with a live table session.
      slug,
      lines: Array.isArray(lines) ? lines.length : null,
      note: note ? 'present' : 'none',
      tableSession: liveSession ? 'present' : 'none',
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
    if (error.code === 'P0001') {
      fail(error.message, slug);
    }

    // The rest are classified rather than flattened into one sentence. A
    // constraint violation and a dropped connection are not the same problem
    // and the guest cannot fix them the same way -- "one of the dishes came
    // off the menu" is actionable, "please try again" is a loop.
    //
    // The database's own words never reach the banner: these are the classes
    // of refusal, written for the person reading them at a table.
    fail(describePlaceFailure(error.code), slug, error.code || 'net');
  }

  if (typeof code !== 'string' || code === '') {
    console.error('[placeOrderAction] function returned no code', code);
    fail('The order did not come back with a number, so it is not confirmed. Please try again.', slug);
  }

  redirect(
    `/menu/order?s=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}&t=${guestToken}`
  );
}
