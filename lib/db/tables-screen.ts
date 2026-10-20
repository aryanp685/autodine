/**
 * Load tables and their QR token state for the locked Tables & QR screen.
 *
 * Returns null when Supabase is not configured, and the screen then falls
 * back to its own demo rows -- the same contract as lib/db/menu-screen.ts,
 * so the locked markup never has to change shape.
 *
 * A real query error is thrown rather than swallowed: silently swapping a
 * live restaurant's floor plan for twelve fictional tables would be worse
 * than an error page.
 *
 * STATUS MAPPING
 *
 * The demo rows carry four QR states. The database has no "printed" column,
 * so the mapping is:
 *
 *   is_active = false        -> 'disabled'  (table out of service)
 *   no live qr_token         -> 'revoked'   (needs a code before it can sell)
 *   live, unexpired token    -> 'active'
 *
 * 'printed' is not derivable from the schema and is never returned here. A
 * real deployment would need a printed_at column to tell whether the card
 * on the table matches the code currently in the database.
 */

import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type TableStatus = 'active' | 'revoked' | 'disabled';

export type TableRow = {
  /**
   * Absent on the demo rows in lib/demo-data.ts. Live rows always have it;
   * the screen only renders the management form when it is present, so a
   * fictional table can never be submitted as if it were real.
   */
  id?: string;
  code: string;
  /** Location descriptor. The schema has no area column, so this is derived. */
  label: string;
  seats: number;
  qr: TableStatus | 'printed';
  /** Humanised time of the most recent order at this table, or '—'. */
  lastScan: string;
  orders: number;
  /** Only set when a live token exists. Never rendered to the page as-is. */
  token?: string | null;
  expiresAt?: string | null;
};

export type TablesScreenData = {
  restaurantName: string;
  tables: TableRow[];
};

/** The seeded demo restaurant. */
export const DEFAULT_SLUG = 'saffron-smoke';

/** How long a table QR stays valid. Short-lived by design: a static printed
 *  code cannot prove a diner is physically in the room. */
export const QR_TTL_HOURS = 12;

function ago(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? '1 h ago' : `${hours} h ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export async function getTablesScreenData(
  slug?: string
): Promise<TablesScreenData | null> {
  if (!isSupabaseConfigured) return null;

  const target = slug?.trim() || DEFAULT_SLUG;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, name')
    .eq('slug', target)
    .maybeSingle();

  if (restaurantError) {
    throw new Error(`Could not load restaurant: ${restaurantError.message}`);
  }
  if (!restaurant) return null;

  const [tablesResult, tokensResult, ordersResult] = await Promise.all([
    supabase
      .from('dining_tables')
      .select('id, label, seats, is_active')
      .eq('restaurant_id', restaurant.id)
      .order('label', { ascending: true }),
    supabase
      .from('qr_tokens')
      .select('id, table_id, token, expires_at')
      .eq('restaurant_id', restaurant.id),
    supabase
      .from('orders')
      .select('table_id, placed_at')
      .eq('restaurant_id', restaurant.id),
  ]);

  if (tablesResult.error) {
    throw new Error(`Could not load tables: ${tablesResult.error.message}`);
  }
  if (tokensResult.error) {
    throw new Error(`Could not load QR tokens: ${tokensResult.error.message}`);
  }
  if (ordersResult.error) {
    throw new Error(`Could not load orders: ${ordersResult.error.message}`);
  }

  const now = Date.now();

  // Latest token per table, and only if it has not expired.
  const liveTokenByTable = new Map<string, { token: string; expiresAt: string }>();
  for (const row of tokensResult.data ?? []) {
    if (!row.table_id) continue;
    const expires = new Date(row.expires_at).getTime();
    if (Number.isNaN(expires) || expires <= now) continue;

    const existing = liveTokenByTable.get(row.table_id);
    if (!existing || expires > new Date(existing.expiresAt).getTime()) {
      liveTokenByTable.set(row.table_id, {
        token: row.token,
        expiresAt: row.expires_at,
      });
    }
  }

  const statsByTable = new Map<string, { orders: number; last: string | null }>();
  for (const row of ordersResult.data ?? []) {
    if (!row.table_id) continue;
    const current = statsByTable.get(row.table_id) ?? { orders: 0, last: null };
    current.orders += 1;
    if (!current.last || row.placed_at > current.last) current.last = row.placed_at;
    statsByTable.set(row.table_id, current);
  }

  const tables: TableRow[] = (tablesResult.data ?? []).map((row) => {
    const token = liveTokenByTable.get(row.id) ?? null;
    const stats = statsByTable.get(row.id);

    return {
      id: row.id,
      code: row.label,
      label: `${row.seats} seater`,
      seats: row.seats,
      qr: !row.is_active ? 'disabled' : token ? 'active' : 'revoked',
      lastScan: ago(stats?.last ?? null),
      orders: stats?.orders ?? 0,
      token: token?.token ?? null,
      expiresAt: token?.expiresAt ?? null,
    };
  });

  return { restaurantName: restaurant.name, tables };
}
