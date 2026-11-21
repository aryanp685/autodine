/**
 * Where a redirect may point, and nowhere else.
 *
 * WHY THIS EXISTS
 *
 * Several forms carry a `next` parameter (login, email confirm) that a server
 * action turns into a redirect. A query string is untrusted input: `?next=` on
 * our domain must never hand a stranger a page that starts at our address and
 * ends on theirs — the shape of every phishing link that trades on a real
 * brand. Each call site used to carry its own check with its own gaps.
 *
 * THE RULE
 *
 * The value must be a same-origin path: it starts with `/`, it is not
 * scheme-relative (`//host`), it contains no backslash (browsers fold `/\`
 * into `//`), it is one level of percent-decoding deep and no more (a second
 * `%` after decoding means double-encoding — `/%2f%2fevil` decodes to
 * `//evil`), and it carries no control characters (a raw CR/LF in a Location
 * header is response splitting). Anything else returns the caller's fallback,
 * because a redirect that goes nowhere is better than one that goes anywhere.
 *
 * This is the shared floor. `lib/verify-next.ts` keeps its own, stricter
 * closed list for the guest verification flow — that list only gets shorter.
 */

/**
 * Resolve an untrusted `next` value into a same-origin path.
 *
 * Returns `fallback` for anything that is not safely one. The returned value
 * is the original string (trimmed), which the rules above already cleared.
 */
export function safeLocalPath(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;

  const raw = value.trim();
  if (!raw) return fallback;

  // Reject the dangerous shapes BEFORE decoding as well: a literal backslash
  // must never reach the parser even if a later rule would also catch it.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;

  // One decoding pass. decodeURIComponent throws on malformed sequences
  // (`/%`), which is also a rejection — a redirect target is not a place for
  // tolerance.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }

  // The decoded form must still be a same-origin path: `/%2f%2fevil` passes
  // the raw checks and decodes to scheme-relative `//evil`.
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return fallback;
  if (decoded.includes('\\')) return fallback;

  // Double-encoding: anything still percent-encoded after one decode is a
  // second layer (`/%252f…` → `/%2f…`), which exists only to smuggle.
  if (decoded.includes('%')) return fallback;

  // Control characters and stray whitespace: CR/LF in a Location header is
  // response splitting, and no real path needs these.
  if (/[\x00-\x1f\x7f\s]/.test(decoded)) return fallback;

  return raw;
}
