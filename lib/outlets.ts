/**
 * Which outlet an owner is looking at.
 *
 * THE MODEL
 *
 * One account, several restaurants. The database has always allowed this --
 * `memberships` is a join table with a role on it -- but every staff screen
 * resolved "the caller's restaurant" with `.limit(1)`, so a second outlet was
 * invisible and a third was unreachable.
 *
 * The active outlet lives in a cookie, and the cookie is only ever a
 * PREFERENCE. It is re-validated against the caller's memberships on every
 * request; a cookie naming a restaurant the caller does not belong to is
 * ignored, not honoured. That is why this module holds no database code: the
 * decision of "which of these may we use" is pure, and is tested as such.
 *
 * `role` travels with each outlet because the same person can be the owner of
 * one outlet and a cashier at another, and the screens already disable
 * controls by role.
 */

/** Cookie name for the chosen outlet. Read in lib/db/staff.ts. */
export const OUTLET_COOKIE = 'ad_outlet';

/**
 * How many outlets one account may own.
 *
 * Not a licensing rule -- a stop on the one abuse this flow opens: creating a
 * restaurant is free and starts a fresh ten-day trial, so an unlimited
 * "add outlet" button is an unlimited free trial. Five is more than the
 * small chains this is built for and few enough to be worth blocking.
 */
export const MAX_OUTLETS_PER_OWNER = 5;

export type OutletOption = {
  id: string;
  name: string;
  /** owner | manager | cashier | kitchen, as the memberships row says. */
  role: string;
};

/** What the dashboard bar needs to show and switch the active outlet. */
export type OutletBar = {
  outlets: OutletOption[];
  activeId: string;
};

/**
 * Choose the outlet to show.
 *
 * Preference first, then the lowest id -- the same deterministic fallback the
 * screens used before this feature existed, so a request with no cookie
 * behaves exactly as it did yesterday instead of picking whichever row
 * Postgres returned first.
 */
export function pickOutlet<T extends { id: string }>(outlets: readonly T[], preferredId: string | null): T | null {
  if (outlets.length === 0) return null;
  if (preferredId) {
    const preferred = outlets.find((outlet) => outlet.id === preferredId);
    if (preferred) return preferred;
  }

  // Compared as text, not with localeCompare: these are uuids, and the point
  // is a stable order, not a human one.
  return [...outlets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/** Up to two letters for the bar's avatar, from the outlet's own name. */
export function outletInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /[a-z0-9\u0900-\u097f]/i.test(word));

  if (words.length === 0) return 'AD';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** What is wrong with a new outlet's name, or null. */
export function outletNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'Give the outlet a name of at least two characters.';
  if (trimmed.length > 80) return 'Keep the outlet name under 80 characters.';
  return null;
}

/**
 * Where a switch may return to.
 *
 * A path on this site and nothing else. The value arrives in a form field, so
 * without this an outlet switch could be turned into an open redirect.
 */
export function safeReturnPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}

/**
 * Whether a mutating request came from this site.
 *
 * The outlet forms post to route handlers, which -- unlike server actions --
 * do not get an origin check from the framework. SameSite=Lax already keeps
 * these cookies off a cross-site POST; this is the second lock on the same
 * door, and it costs one comparison.
 *
 * Vercel sets both headers on every request; the comparison is on host only,
 * not scheme, because a proxy may report either and "different scheme" is not
 * an attack this is defending against.
 */
export function sameOrigin(originHeader: string | null, hostHeader: string | null): boolean {
  if (!originHeader || !hostHeader) return false;
  try {
    return new URL(originHeader).host === hostHeader;
  } catch {
    return false;
  }
}
