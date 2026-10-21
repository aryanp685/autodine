/**
 * The table a guest is sitting at.
 *
 * A QR code printed on a table carries a public token. Scanning it opens the
 * verification screen, and entering the six digits showing inside the
 * restaurant exchanges both -- the card AND the code -- for a short-lived
 * session. The session is what says which restaurant and which table an order
 * belongs to.
 *
 * WHY THE CARD ALONE IS NOT ENOUGH
 *
 * A card can be photographed, forwarded, or printed on a rival's table. It
 * proves somebody has SEEN the table, not that they are at it. The code is
 * what a person can only read from inside the room, and it changes every ten
 * minutes, so a code that was passed along a phone is usually dead before it
 * arrives. See migration 20261023000900 for the full argument.
 *
 * The session token is a bearer capability -- anyone holding it can order at
 * that table -- so it lives in a cookie that is:
 *
 *   httpOnly  so a script on the page cannot read it and ship it elsewhere
 *   sameSite  lax so a link from elsewhere does not carry it
 *   path /    so every ordering route sees it
 *
 * It is NOT signed or encrypted by us. It does not need to be: it is 64 hex
 * characters of randomness, it is stored in the database only as a SHA-256
 * hash, and it expires. A cookie we could not validate would simply fail the
 * lookup.
 *
 * That lookup is the point. Nothing here decides whether a guest may see the
 * menu or place an order -- see lib/table-access.ts, which asks the database.
 * This file only moves the token around and checks its shape.
 *
 * Deliberately separate from the Supabase auth cookie. A guest has no
 * account, and mixing the two would mean a signed-out diner and a signed-in
 * cashier looked like the same kind of thing.
 */

import { cookies } from 'next/headers';

export const TABLE_SESSION_COOKIE = 'autodine_table';

/**
 * Shape stored in the cookie. Kept small; the database holds the rest.
 *
 * Every field below is either derived from a live database answer or copied
 * from the URL of the card that was scanned. None of it is trusted: the token
 * is re-resolved on every guest page, and the slug and label in here are only
 * used to render a badge after that lookup has agreed with them.
 */
export type TableSession = {
  /** The raw 64-character hex token. Never stored server-side in the clear. */
  token: string;
  slug: string;
  tableLabel: string;
  expiresAt: string;
  /**
   * The public token of the card that was scanned, from the URL, not a
   * secret -- it is printed on the table.
   *
   * It is kept so that an expired session can send the guest back to
   * /t/<token> to enter a fresh code, instead of leaving them on a menu with
   * no explanation. Optional because cookies written before this field
   * existed do not have it, and because a cookie is customer-editable.
   */
  qrToken?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** The card's public token, as it appears in /t/<token>. */
export function isQrToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

/**
 * Read the session from the cookie.
 *
 * Returns null for anything that does not parse into exactly the shape
 * written by this file. A cookie is customer-editable, so this is an
 * untrusted-input boundary and is treated as one: a malformed value is not an
 * error to surface, it is simply no session.
 *
 * The token is validated on shape AND on use. Shape here so a garbage cookie
 * never reaches the database; on use because only the database knows whether
 * the session is still live.
 */
export async function readTableSession(): Promise<TableSession | null> {
  const raw = (await cookies()).get(TABLE_SESSION_COOKIE)?.value;
  if (!raw) return null;

  return parseTableSession(raw);
}

/** The parse half of readTableSession: cookie in, session or null out. */
function parseTableSession(raw: string | undefined | null): TableSession | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const entry = parsed as Record<string, unknown>;

  if (!isNonEmptyString(entry.token)) return null;
  if (!/^[A-Fa-f0-9]{64}$/.test(entry.token)) return null;
  if (!isNonEmptyString(entry.slug)) return null;
  if (!isNonEmptyString(entry.tableLabel)) return null;
  if (typeof entry.expiresAt !== 'string') return null;

  const session: TableSession = {
    token: entry.token,
    slug: entry.slug,
    tableLabel: entry.tableLabel,
    expiresAt: entry.expiresAt,
  };

  // Dropped rather than rejected: an old cookie without it is still a valid
  // session, it just cannot offer the "verify again" shortcut.
  if (isQrToken(entry.qrToken)) session.qrToken = entry.qrToken;

  return session;
}

/**
 * Whether the session has expired, judged on the clock in the cookie.
 *
 * This is a convenience for rendering, not a security check. The database
 * re-checks expiry on every page and every order, and that is the check that
 * counts.
 */
export function isExpired(session: TableSession, now: Date = new Date()): boolean {
  const at = Date.parse(session.expiresAt);
  if (Number.isNaN(at)) return true;
  return at <= now.getTime();
}

/** Cookie options, shared by the action that sets it and any that clears it. */
export const TABLE_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60, // matches the database's one-hour ceiling on a session
};

/**
 * Write the session cookie. Server Actions only.
 *
 * Route Handlers set it on the response instead (one response, one place the
 * cookie is written); this is for the action that redeems a code, which has
 * no response object of its own.
 *
 * The lifetime is a minute shorter than the session the database issued, so
 * the browser forgets first. A guest should never be holding a cookie for a
 * session that is already gone -- that is exactly the state that used to
 * leave the menu quietly without a table.
 */
export async function saveTableSession(session: TableSession): Promise<void> {
  (await cookies()).set(TABLE_SESSION_COOKIE, JSON.stringify(session), {
    ...TABLE_SESSION_COOKIE_OPTIONS,
    maxAge: 60 * 59,
  });
}
