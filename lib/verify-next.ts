/**
 * Where a guest goes AFTER the code is accepted.
 *
 * WHY THIS IS A CLOSED LIST AND NOT A URL
 *
 * The verification form is reached from several places -- the card page, the
 * checkout, an expired-session notice -- and each of them wants the guest back
 * where they were. The obvious way to do that is a `next` query parameter that
 * the action redirects to. That is also, precisely, an open redirect: a link
 * with `?next=https://somewhere-else` on our domain would hand a stranger a
 * page that starts at our address and ends somewhere else, which is the shape
 * of every phishing link that trades on a real brand.
 *
 * So the destination is not a URL. It is a path this file already knows, plus
 * an optional restaurant slug. Anything else falls back to the menu. A list
 * that only gets shorter is a list that cannot be talked into an attacker's
 * domain by a query string.
 */

/** The guest screens a verification may return to. */
const ALLOWED_PATHS = new Set(['/menu', '/menu/cart', '/menu/checkout', '/menu/orders']);

/** A slug is lowercase, hyphenated, and never anything else. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Resolve `next` (untrusted) plus `slug` (known) into a path on this site.
 *
 * `slug` is the restaurant the guest is actually verified for, and it wins
 * over anything the query string says: a `next` that names a different
 * restaurant would send them to a page whose gate would immediately refuse
 * them, which is a dead end dressed up as a redirect.
 */
export function safeNextPath(next: string | null | undefined, slug?: string | null): string {
  const fallback = slug && SLUG.test(slug) ? `/menu?s=${encodeURIComponent(slug)}` : '/menu';

  if (typeof next !== 'string') return fallback;

  const raw = next.trim();
  // Reject scheme-relative and absolute URLs before parsing: `//host` and
  // `/\host` are both read as a host by a browser.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://placeholder.invalid');
  } catch {
    return fallback;
  }

  // A token like `..` is normalised away by URL, so the pathname has to be
  // checked after parsing, not before.
  if (!ALLOWED_PATHS.has(parsed.pathname)) return fallback;

  const query = new URLSearchParams();
  if (slug && SLUG.test(slug)) query.set('s', slug);

  return query.toString() ? `${parsed.pathname}?${query.toString()}` : parsed.pathname;
}
