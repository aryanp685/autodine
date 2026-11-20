/** Minimal persisted status scoped by exact slug + code + order capability. */

import type { Database } from '@/lib/db/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OrderStatusSnapshot } from '@/lib/guest-order-status';
import { revisionNumber } from '@/lib/realtime-revisions';

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
  revision?: unknown;
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

  const args = { p_slug: slug, p_code: code, p_token: token };
  const minimal = await supabase.rpc('get_guest_order_status', args);
  const { data, error } = minimal.error && ['PGRST202', '42883'].includes(minimal.error.code)
    ? await supabase.rpc('get_public_order', args) : minimal;

  if (error) return { kind: 'unavailable', message: 'Order status is temporarily unavailable.' };
  if (!data) return { kind: 'not_found' };

  const row = data as PublicOrderRow;
  const prepStatus = typeof row.prep_status === 'string' ? row.prep_status : '';
  if (!prepStatus) return { kind: 'unavailable', message: 'The order has no status.' };

  return {
    kind: 'ok',
    snapshot: {
      status: prepStatus,
      ...(revisionNumber(row.revision) !== null ? { revision: String(row.revision) } : {}),
      // Held for a human to confirm: the guest must not be told cooking started.
      awaitingConfirmation: row.hold_required === true && !row.confirmed_at,
      paymentStatus: typeof row.payment_status === 'string' ? row.payment_status : 'pending',
      placedAt: typeof row.placed_at === 'string' ? row.placed_at : '',
      checkedAt: new Date().toISOString(),
    },
  };
}
