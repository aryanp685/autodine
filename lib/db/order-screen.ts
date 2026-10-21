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
  lines: OrderLine[];
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
      .select('name, online_payments_enabled')
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

  return {
    id,
    code: text(order.code),
    restaurantName: text(restaurantResult.data?.name as unknown) || 'Your table',
    tableLabel: text(order.table_label) || null,
    prepStatus,
    paymentStatus,
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
