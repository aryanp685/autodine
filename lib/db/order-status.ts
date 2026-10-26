/**
 * One order's live status, as its guest.
 *
 * THE ONLY READ THIS DOES IS get_public_order()
 *
 * That function takes the restaurant slug, the order code and the guest token,
 * and returns a row only when all three match -- so a token for table 4's order
 * can never be pointed at another order, another table, or another restaurant.
 * There is no "status by id" path here on purpose: an endpoint that accepted an
 * id would be an endpoint that answers questions about anybody's order to
 * anybody who has an id.
 *
 * WHY A SEPARATE CALL FROM getOrderScreenData()
 *
 * That loader also reads the restaurant row, builds the UPI QR (which renders
 * an SVG server-side) and parses every line item. Polling it every ten seconds
 * would pay for all of that to answer one question -- "which of five states is
 * it in" -- and would put a QR encode in a phone's refresh loop. This reads the
 * one function and returns four fields.
 */

import type { Database } from '@/lib/db/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OrderStatusSnapshot } from '@/lib/guest-order-status';

/**
 * Order tokens are UUIDs (orders.guest_token is a uuid column).
 *
 * Checked before the call rather than after: passing a non-uuid string to
 * get_public_order() raises 22P02 in Postgres, which arrives as a 500 and looks
 * like a broken deployment instead of what it is -- a stale or mangled link.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrderToken(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID.test(value.trim());
}

export type GuestOrderStatusResult =
  | { kind: 'ok'; snapshot: OrderStatusSnapshot }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; message: string };

type PublicOrderRow = {
  prep_status?: unknown;
  payment_status?: unknown;
  placed_at?: unknown;
  hold_required?: unknown;
  confirmed_at?: unknown;
};

/** Same client shape the read uses; named so a test can pass a fake. */
export type StatusClient = Pick<SupabaseClient<Database>, 'rpc'>;

export async function readGuestOrderStatus(
  input: { slug?: string | null; code?: string | null; token?: string | null },
  client?: StatusClient | null,
): Promise<GuestOrderStatusResult> {
  const slug = input.slug?.trim() ?? '';
  const code = input.code?.trim() ?? '';
  const token = input.token?.trim() ?? '';

  if (!slug || !code || !isOrderToken(token)) return { kind: 'not_found' };

  if (!client && !isSupabaseConfigured) return { kind: 'unavailable', message: 'No database is connected.' };

  const supabase = client ?? (await createSupabaseServerClient());
  if (!supabase) return { kind: 'unavailable', message: 'No database is connected.' };

  const { data, error } = await supabase.rpc('get_public_order', {
    p_slug: slug,
    p_code: code,
    p_token: token,
  });

  if (error) return { kind: 'unavailable', message: error.message };
  if (!data) return { kind: 'not_found' };

  const row = data as PublicOrderRow;
  const prepStatus = typeof row.prep_status === 'string' ? row.prep_status : '';
  if (!prepStatus) return { kind: 'unavailable', message: 'The order has no status.' };

  return {
    kind: 'ok',
    snapshot: {
      status: prepStatus,
      // Held for a human to confirm: the guest must not be told cooking started.
      awaitingConfirmation: row.hold_required === true && !row.confirmed_at,
      paymentStatus: typeof row.payment_status === 'string' ? row.payment_status : 'pending',
      placedAt: typeof row.placed_at === 'string' ? row.placed_at : '',
      checkedAt: new Date().toISOString(),
    },
  };
}
