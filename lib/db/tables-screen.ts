/**
 * Load tables and their QR token state for the locked Tables & QR screen.
 *
 * This is a staff screen, so the restaurant comes from the caller's membership
 * row rather than from a slug. It used to be addressed by a hardcoded slug
 * naming a seeded demo venue that no longer exists, which meant a signed-in
 * owner was shown twelve fictional tables as though they were the floor plan
 * they had to run service on tonight.
 *
 * Returns null when Supabase is not configured, and the screen then falls
 * back to its own demo rows -- the same contract as lib/db/menu-screen.ts,
 * so the locked markup never has to change shape. A configured-but-blocked
 * caller gets `blocked` instead and must be shown a prompt, never the demo
 * rows.
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
 *   is_active = false   -> 'disabled'  (table out of service)
 *   no live code        -> 'revoked'   (needs a code before it can sell)
 *   a live code         -> 'active'
 *
 * 'revoked' should now be unreachable for a live table: migration 0007 puts a
 * trigger on dining_tables so a row cannot be inserted without a code
 * following it, and backfills every table that predates the trigger. The
 * branch is kept because the trigger can be dropped, and because finding out
 * that a table has no code is exactly what this screen is for.
 *
 * 'printed' is not derivable from the schema and is never returned here. A
 * real deployment would need a printed_at column to tell whether the card
 * on the table matches the code currently in the database.
 *
 * ON qr_tokens
 *
 * This used to read qr_tokens, the twelve-hour rotating scheme. It does not
 * any more, and nothing writes to that table either. table_qr_codes is the
 * scheme that scanning actually uses -- see migration 0007 for why the older
 * functions were left in place rather than granted.
 */

import { getStaffContextDetailed } from './staff';
import { qrSvg, siteOrigin, tableScanUrl } from '../qr';

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
  /**
   * The code this table scans with. Shown to staff in full, because they have
   * to be able to reprint a card, and they are already inside the
   * restaurant's own dashboard to see it.
   */
  token?: string | null;
  /** The absolute URL the printed card encodes. Never guessed; always built. */
  scanUrl?: string | null;
  /** Rendered QR for that URL, or null if it could not be encoded. */
  qrSvg?: string | null;
};

/**
 * The six digits showing on the screen inside the restaurant right now.
 *
 * This is the second half of the scan: the card proves the guest has seen the
 * table, this code proves somebody in the room can read a screen. It is
 * derived from a per-restaurant secret and the current ten-minute window, so
 * there is nothing stored to leak and nothing to keep in sync -- see
 * migration 20261023000900.
 *
 * Only staff can read it (the RPC checks membership), which is the whole
 * point: if a guest could fetch this, entering it would prove nothing.
 */
export type VerificationCode = {
  code: string;
  expiresAt: string;
  windowSeconds: number;
};

export type TablesScreenData = {
  restaurantName: string;
  tables: TableRow[];
  /**
   * Null when the code could not be read (see verificationError) or when the
   * caller is blocked. The screen renders the panel only when it has digits:
   * showing an empty box where a code belongs would look like the feature is
   * broken rather than like it is unavailable.
   */
  verification?: VerificationCode | null;
  /** Why the code could not be read, if it could not. Staff-facing only. */
  verificationError?: string;
  /** Set when the caller has no restaurant to show. See lib/db/staff.ts. */
  blocked?: 'signed-out' | 'no-membership';
};

// There is deliberately no QR_TTL_HOURS any more.
//
// The twelve-hour rotation it described belonged to qr_tokens, and that
// scheme has been replaced. A printed card cannot be rotated on a timer --
// nobody is going to reprint five cards every twelve hours -- so the card
// now carries a permanent token, and what expires is the *session* a scan
// creates from it, inside the database. See migration 0007.
//
// Rotation is still available, as an explicit act: rotating a code is how a
// restaurant takes a leaked one out of service. It is a decision someone
// makes, not a clock running down.

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

export async function getTablesScreenData(): Promise<TablesScreenData | null> {
  const staff = await getStaffContextDetailed();

  // Nested rather than a compound condition: a narrowed && does not carry into
  // the next if, so the union would stay wide and `blocked` would not typecheck.
  if (!staff.ok) {
    if (staff.reason === 'unconfigured') return null;
    return { restaurantName: '', tables: [], blocked: staff.reason };
  }

  const { supabase, restaurantId, restaurantName } = staff.context;

  const [tablesResult, tokensResult, ordersResult, codeResult] = await Promise.all([
    supabase
      .from('dining_tables')
      .select('id, label, seats, is_active')
      .eq('restaurant_id', restaurantId)
      .order('label', { ascending: true }),
    supabase
      .from('table_qr_codes')
      .select('id, table_id, public_token, created_at')
      .eq('restaurant_id', restaurantId)
      .is('revoked_at', null),
    supabase
      .from('orders')
      .select('table_id, placed_at')
      .eq('restaurant_id', restaurantId),
    // The on-site code. SECURITY DEFINER with a membership check inside, so
    // this cannot be pointed at another restaurant by passing an id from the
    // browser -- restaurantId here came from the caller's own membership row.
    supabase.rpc('current_verification_code', { p_restaurant_id: restaurantId }),
  ]);

  if (tablesResult.error) {
    throw new Error(`Could not load tables: ${tablesResult.error.message}`);
  }
  if (tokensResult.error) {
    throw new Error(`Could not load QR codes: ${tokensResult.error.message}`);
  }
  if (ordersResult.error) {
    throw new Error(`Could not load orders: ${ordersResult.error.message}`);
  }

  // Unlike the three reads above, a failure here is not fatal: the rest of the
  // floor plan is still worth showing, and the panel that displays the code is
  // the only thing that needs it.
  const codeRow = Array.isArray(codeResult.data) ? codeResult.data[0] : codeResult.data;
  const verification: VerificationCode | null =
    codeRow && typeof codeRow.code === 'string'
      ? {
          code: codeRow.code,
          expiresAt: codeRow.expires_at,
          windowSeconds: codeRow.window_seconds ?? 600,
        }
      : null;

  if (codeResult.error) {
    console.error('[tables-screen] could not read verification code', codeResult.error);
  }

  // One live code per table. The query already excludes revoked rows, and the
  // trigger in migration 0007 keeps a table to one; this picks the newest so
  // a table that somehow ended up with two still resolves to a single answer
  // rather than whichever the database happened to return first.
  const liveCodeByTable = new Map<string, string>();
  for (const row of tokensResult.data ?? []) {
    if (!row.table_id || !row.public_token) continue;
    liveCodeByTable.set(row.table_id, row.public_token);
  }

  // Every card is rendered here rather than in the component, so the SVG is
  // built once per table on the server and the page carries no encoder with
  // it. The origin is resolved from the request: a code printed with the
  // preview host baked in is a dead card in production.
  const origin = await siteOrigin();
  const svgByToken = new Map<string, string>();
  await Promise.all(
    [...liveCodeByTable.values()].map(async (token) => {
      const svg = await qrSvg(tableScanUrl(origin, token));
      if (svg) svgByToken.set(token, svg);
    })
  );

  const statsByTable = new Map<string, { orders: number; last: string | null }>();
  for (const row of ordersResult.data ?? []) {
    if (!row.table_id) continue;
    const current = statsByTable.get(row.table_id) ?? { orders: 0, last: null };
    current.orders += 1;
    if (!current.last || row.placed_at > current.last) current.last = row.placed_at;
    statsByTable.set(row.table_id, current);
  }

  const tables: TableRow[] = (tablesResult.data ?? []).map((row) => {
    const token = liveCodeByTable.get(row.id) ?? null;
    const stats = statsByTable.get(row.id);

    return {
      id: row.id,
      code: row.label,
      label: `${row.seats} seater`,
      seats: row.seats,
      qr: !row.is_active ? 'disabled' : token ? 'active' : 'revoked',
      lastScan: ago(stats?.last ?? null),
      orders: stats?.orders ?? 0,
      token,
      scanUrl: token ? tableScanUrl(origin, token) : null,
      qrSvg: token ? (svgByToken.get(token) ?? null) : null,
    };
  });

  return {
    restaurantName,
    tables,
    verification,
    ...(codeResult.error
      ? { verificationError: 'The on-site code could not be read. Guests will not be able to verify until it is.' }
      : {}),
  };
}
