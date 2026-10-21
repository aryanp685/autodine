/**
 * The table a guest is sitting at.
 *
 * A QR code printed on a table carries a public token. Scanning it exchanges
 * that token for a short-lived session, and the session is what says which
 * restaurant and which table an order belongs to.
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
 * Deliberately separate from the Supabase auth cookie. A guest has no
 * account, and mixing the two would mean a signed-out diner and a signed-in
 * cashier looked like the same kind of thing.
 */

import { cookies } from 'next/headers';

export const TABLE_SESSION_COOKIE = 'autodine_table';

/** Shape stored in the cookie. Kept small; the database holds the rest. */
export type TableSession = {
  /** The raw 64-character hex token. Never stored server-side in the clear. */
  token: string;
  slug: string;
  tableLabel: string;
  expiresAt: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
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

  return {
    token: entry.token,
    slug: entry.slug,
    tableLabel: entry.tableLabel,
    expiresAt: entry.expiresAt,
  };
}

/**
 * Whether the session has expired, judged on the clock in the cookie.
 *
 * This is a convenience for rendering, not a security check. The database
 * re-checks expiry on every order, and that is the check that counts.
 */
export function isExpired(session: TableSession, now: Date = new Date()): boolean {
  const at = Date.parse(session.expiresAt);
  if (Number.isNaN(at)) return true;
  return at <= now.getTime();
}

/** Cookie options, shared by the route that sets it and any that clears it. */
export const TABLE_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60, // matches the database's one-hour ceiling on a session
};
