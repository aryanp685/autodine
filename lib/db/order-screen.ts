/**
 * One order, for the confirmation screen and for the guest's own controls.
 *
 * HOW A GUEST PROVES AN ORDER IS THEIRS
 *
 * Not by its code. A code like "MA-K3F9Q" is short, printed on the screen, and
 * read out at the counter -- it is a reference, not a secret. Until migration
 * 00600 an anonymous visitor could not read public.orders at all (the only
 * policies on it are for signed-in staff), which is why every guest used to
 * see "Order not found" on their own order.
 *
 * So the order carries an unguessable guest_token, issued once in the link the
 * guest is redirected to after placing. The token is the credential, and the
 * read goes through public.get_public_order(), a SECURITY DEFINER function
 * that returns nothing unless slug, code and token all match.
 *
 * A guest who loses the link cannot see the order here. That is a real cost
 * and it is the honest one: the alternative is a page that shows somebody
 * else's bill to anyone who guesses five characters.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { qrSvg } from '@/lib/qr';

/**
 * How long after placing an order a guest may still change or cancel it.
 *
 * Mirrors k_guest_window inside public.cancel_order(). The database is the one
 * that decides -- this only stops the buttons being drawn on an order the
 * database would refuse, so the screen and the rule cannot tell different
 * stories.
 */
export const GUEST_CHANGE_WINDOW_MS = 10 * 60 * 1000;

export type OrderLine = {
  /** order_items.id. Needed to change the quantity of this line. */
  id: string;
  name: string;
  qty: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  isVeg: boolean;
  /** Which portion, as it was when the order was placed. */
  variantName: string | null;
  /** Add-ons as they were charged, e.g. ["Extra cheese"]. */
  addons: string[];
};

export type OrderScreenData = {
  id: string;
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
  /**
   * Migration 20261028000900. The order arrived in a scan-mode restaurant and
   * no human has vouched for the table yet, so it is NOT in the kitchen queue.
   * The screen must say that rather than letting "order placed" imply cooking
   * has started.
   */
  awaitingConfirmation: boolean;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  customerNote: string | null;
  placedAt: string;
  /**
   * Whether the guest may still change quantities or cancel, right now.
   *
   * Three things have to be true: the kitchen has not started (prep 'new'),
   * nothing has been paid, and the order is inside the ten minute window.
   */
  canGuestChange: boolean;
  /**
   * Has the owner switched online (card/UPI) payment on for this outlet?
   *
   * Only the restaurant's own switch. Whether this DEPLOYMENT has a gateway
   * key is decided on the page, because that is an environment question and
   * this module's job is to read the restaurant. See
   * lib/payments/online-availability.ts for how the two combine.
   */
  onlineEnabled: boolean;
  /**
   * The restaurant's OWN UPI handle, when it has configured one.
   *
   * This is not a gateway. It is the shop's existing standee, on the guest's
   * phone, with the amount filled in — and the screen says so: paying into it
   * does not mark the order paid, and the counter confirms it against its own
   * bank app. Null when the restaurant set no handle, or once the order is
   * settled: a QR beside a paid bill invites somebody to pay twice.
   */
  upi: UpiPayment | null;
  lines: OrderLine[];
};

export type UpiPayment = {
  /** e.g. 'thegulmohar@okhdfcbank'. Displayed, so a guest can check the payee. */
  upiId: string;
  /** Who receives it, as the restaurant named itself. Never a platform name. */
  payeeName: string;
  /** What is still owed. Read from the database, not from the order total. */
  duePaise: number;
  /** `upi://pay?...` — opens the guest's UPI app with the amount filled in. */
  uri: string;
  /** Inline SVG of `uri`, or null if the encoder failed. */
  svg: string | null;
  /** Set once the guest has pressed "I have paid". Not proof of payment. */
  claimedAt: string | null;
};

/** The jsonb shape returned by public.get_public_order(). */
type PublicOrderPayload = {
  id?: unknown;
  code?: unknown;
  prep_status?: unknown;
  payment_status?: unknown;
  subtotal_paise?: unknown;
  tax_paise?: unknown;
  total_paise?: unknown;
  customer_note?: unknown;
  placed_at?: unknown;
  table_label?: unknown;
  hold_required?: unknown;
  confirmed_at?: unknown;
  lines?: unknown;
};

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function line(value: unknown): OrderLine | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  if (!id) return null;

  const unit = num(row.unit_price_paise);
  const qty = num(row.qty);

  return {
    id,
    name: text(row.name),
    qty,
    unitPricePaise: unit,
    lineTotalPaise: unit * qty,
    isVeg: row.is_veg === true,
    variantName: text(row.variant) || null,
    addons: Array.isArray(row.addons) ? row.addons.filter((a): a is string => typeof a === 'string') : [],
  };
}

export async function getOrderScreenData(
  slug?: string,
  code?: string,
  token?: string
): Promise<OrderScreenData | null> {
  if (!isSupabaseConfigured) return null;
  if (!slug?.trim() || !code?.trim() || !token?.trim()) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const [restaurantResult, orderResult] = await Promise.all([
    supabase
      .from('restaurants')
      .select('name, online_payments_enabled, upi_id, upi_payee_name')
      .eq('slug', slug.trim())
      .eq('is_active', true)
      .maybeSingle(),
    supabase.rpc('get_public_order', {
      p_slug: slug.trim(),
      p_code: code.trim(),
      p_token: token.trim(),
    }),
  ]);

  if (restaurantResult.error) {
    throw new Error(`Could not load restaurant: ${restaurantResult.error.message}`);
  }
  if (orderResult.error) {
    throw new Error(`Could not load the order: ${orderResult.error.message}`);
  }

  if (!orderResult.data) return null;

  const order = orderResult.data as PublicOrderPayload;
  const id = text(order.id);
  if (!id) return null;

  const prepStatus = text(order.prep_status);
  const paymentStatus = text(order.payment_status);
  const placedAt = text(order.placed_at);

  const placedMs = new Date(placedAt).getTime();
  const insideWindow =
    !Number.isNaN(placedMs) && Date.now() - placedMs <= GUEST_CHANGE_WINDOW_MS;

  const totalPaise = num(order.total_paise);
  const upi = await loadUpi({
    slug: slug.trim(),
    code: code.trim(),
    token: token.trim(),
    upiId: (restaurantResult.data as { upi_id?: string | null } | null)?.upi_id ?? null,
    payeeName:
      (restaurantResult.data as { upi_payee_name?: string | null } | null)?.upi_payee_name ?? null,
    restaurantName: text(restaurantResult.data?.name as unknown) || 'Your table',
    paymentStatus,
    totalPaise,
  });

  return {
    id,
    upi,
    code: text(order.code),
    restaurantName: text(restaurantResult.data?.name as unknown) || 'Your table',
    tableLabel: text(order.table_label) || null,
    prepStatus,
    paymentStatus,
    awaitingConfirmation: order.hold_required === true && !order.confirmed_at,
    subtotalPaise: num(order.subtotal_paise),
    taxPaise: num(order.tax_paise),
    totalPaise: num(order.total_paise),
    customerNote: text(order.customer_note) || null,
    placedAt,
    canGuestChange:
      prepStatus === 'new' && paymentStatus === 'pending' && insideWindow,
    onlineEnabled: restaurantResult.data?.online_payments_enabled === true,
    lines: (Array.isArray(order.lines) ? order.lines : [])
      .map(line)
      .filter((row): row is OrderLine => row !== null),
  };
}

/**
 * Build the payment panel, or return null.
 *
 * Two rules, both about not showing a code that cannot be honoured:
 *
 *   1. No handle configured, no QR. A restaurant that never filled this in gets
 *      the pay-at-counter sentence it already had, not a QR pointing nowhere.
 *   2. Paid order, no QR. Money already recorded means a second scan is a
 *      double payment, and getting that money back is the restaurant's problem.
 *
 * The amount comes from public_upi_details(), which subtracts recorded
 * payments from the order total. The total on screen and the amount in the QR
 * therefore cannot disagree, and a partly-paid order offers only what is left.
 */
async function loadUpi(input: {
  slug: string;
  code: string;
  token: string;
  upiId: string | null;
  payeeName: string | null;
  restaurantName: string;
  paymentStatus: string;
  totalPaise: number;
}): Promise<UpiPayment | null> {
  const upiId = input.upiId?.trim() ?? '';
  if (!upiId) return null;
  if (input.paymentStatus === 'paid') return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('public_upi_details', {
    p_slug: input.slug,
    p_code: input.code,
    p_token: input.token,
  });

  // The function is the only source for what is owed and whether a claim
  // exists. If it is missing (migrations not applied) the panel is simply not
  // drawn -- the guest still has "pay at the counter".
  if (error || !data) {
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      console.error('[order-screen] public_upi_details failed', error.message);
    }
    return null;
  }

  const duePaise = num(data.due_paise);
  if (duePaise <= 0) return null;

  const payeeName = text(data.payee_name) || input.payeeName || input.restaurantName;

  // UPI's own deep-link scheme. `cu` is mandatory in practice for some apps;
  // `tn` is capped at 50 characters by NPCI and is truncated rather than
  // rejected, because a shortened note is better than a QR that will not open.
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: (duePaise / 100).toFixed(2),
    cu: 'INR',
    tn: `Order ${input.code}`.slice(0, 50),
  });
  const uri = `upi://pay?${params.toString()}`;

  return {
    upiId,
    payeeName,
    duePaise,
    uri,
    svg: await qrSvg(uri),
    claimedAt: typeof data.claimed_at === 'string' ? data.claimed_at : null,
  };
}
