/**
 * May this browser see the menu, and who is it ordering as?
 *
 * THE QUESTION THIS FILE ANSWERS
 *
 * /menu used to render the real menu for anyone who opened it, and only the
 * table badge depended on the session. So a link could be forwarded to
 * somebody who never went near the restaurant, and they could read -- and,
 * until the checkout gate, place -- an order.
 *
 * The cookie cannot answer the question. It is a browser value: it can be
 * copied, edited, kept past its expiry, or simply be old. The database can
 * answer it, and does, through current_table_session(): expiry, revocation,
 * the table still being in service, the card still being live, and the
 * restaurant still taking orders all have to agree.
 *
 * So every guest page asks here, and this file asks the database. Nothing on
 * the guest side reads a cookie and concludes anything from it.
 *
 * WHY IT RETURNS A UNION RATHER THAN A BOOLEAN
 *
 * "Not verified" is four different situations with four different things to
 * say:
 *
 *   none         no cookie at all -- likely never scanned
 *   stale        a session that has expired, or is for a different restaurant
 *   unavailable  the database could not be asked
 *   verified     the database said yes
 *
 * Collapsing them would produce either a lie ("your table expired" to somebody
 * who never had one) or a dead end. The reasons each guest page shows are
 * built from these.
 *
 * `demo` exists for the same reason lib/db/menu-screen.ts has one: the site
 * must build and render with no environment variables at all.
 */

import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  isExpired,
  readTableSession,
  type TableSession,
} from '@/lib/table-session';

export type TableAccess =
  /**
   * The database confirmed this browser is at a live table in this
   * restaurant. `session` carries the database's own answer, not the
   * cookie's: the label and expiry rendered to the guest are the ones the
   * row holds right now.
   */
  | { status: 'verified'; session: TableSession; slug: string; tableLabel: string }
  /** No database configured: render the demo screens, as before. */
  | { status: 'demo'; tableLabel: string | null }
  /** No usable cookie: this guest has not scanned a card. */
  | { status: 'none' }
  /**
   * A cookie was present and the database refused it. `qrToken` is the public
   * token of the card that was scanned, when the cookie still remembers it,
   * so the page can offer one tap back to the code form.
   */
  | { status: 'stale'; qrToken: string | null; slug: string | null }
  /** The database could not be reached or answered with an error. */
  | { status: 'unavailable' };

/**
 * Resolve the current guest's table access.
 *
 * `slug`, when given, is the restaurant the page is about to render. A session
 * for a different restaurant is not access to this one -- guests wander
 * between links, and an order must never be stamped with a table in a
 * building they are not in.
 */
export async function loadTableAccess(slug?: string | null): Promise<TableAccess> {
  const session = await readTableSession();

  if (!isSupabaseConfigured) {
    // Demo mode: there is no database to ask, so the cookie's own claim is all
    // there is. Rendering a badge here is the pre-existing behaviour of every
    // demo screen, and nothing real is ordered in this mode.
    const tableLabel = session && !isExpired(session) ? session.tableLabel : null;
    return { status: 'demo', tableLabel };
  }

  if (!session) return { status: 'none' };

  const supabase = await createSupabaseServerClient();
  // Configured but no client is not a state that should happen; if it ever
  // does, fail closed. Rendering the menu here would be the exact hole this
  // file exists to close.
  if (!supabase) return { status: 'unavailable' };

  const { data, error } = await supabase.rpc('current_table_session', {
    p_token: session.token,
  });

  if (error) {
    // Deliberately not "stale": a database that cannot answer is not the
    // guest's fault, and sending them to re-verify would fail the same way.
    console.error('[table-access] could not resolve table session', error);
    return { status: 'unavailable' };
  }

  const row = Array.isArray(data) ? data[0] : undefined;

  if (!row) {
    return { status: 'stale', qrToken: session.qrToken ?? null, slug: session.slug };
  }

  if (slug && slug.trim() !== '' && slug.trim() !== row.restaurant_slug) {
    // A live session, but for somewhere else. The guest is real and verified;
    // they are just looking at the wrong restaurant's link.
    return { status: 'stale', qrToken: session.qrToken ?? null, slug: session.slug };
  }

  return {
    status: 'verified',
    slug: row.restaurant_slug,
    tableLabel: row.table_label,
    session: {
      token: session.token,
      slug: row.restaurant_slug,
      tableLabel: row.table_label,
      expiresAt: row.expires_at,
      ...(session.qrToken ? { qrToken: session.qrToken } : {}),
    },
  };
}

/**
 * Where a guest goes to prove they are at a table, when we know which card
 * they scanned. Null when the cookie has been cleared or predates the field --
 * in that case the only honest answer is "scan the code on your table".
 */
export function verifyAgainHref(access: TableAccess): string | null {
  return access.status === 'stale' && access.qrToken ? `/t/${access.qrToken}` : null;
}
