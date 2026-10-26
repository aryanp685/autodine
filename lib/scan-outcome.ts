/**
 * What a scan's answer from the database means for the guest.
 *
 * WHY THIS IS A MODULE AND NOT THREE `if`s IN THE ROUTE
 *
 * `open_table_session` answers with a status word, and the route used to treat
 * everything that was not `opened` the same way: no cookie, go to the menu.
 * That is right for `code` (the guest will be asked for digits at checkout) and
 * right for `revoked`/`unreadable` (the card is dead), but it is NOT right for
 * `limited`, because a throttled guest in a scan-mode restaurant has no code to
 * fall back to. They get a readable menu, a fillable cart, and a checkout that
 * can never succeed — silently.
 *
 * The status set is the whole contract between the database and this handler,
 * so it lives here, in one table, with no database and no Next.js in sight:
 * every branch is unit-testable, and a new status word from a future migration
 * cannot be silently mis-handled (an unknown word gets the reserved answer).
 *
 * WHAT IS DELIBERATELY NOT DECIDED HERE
 *
 * The proposed L1 behaviour — reuse a live session instead of minting a new one,
 * and hold the first order of a throttled sitting for one staff tap rather than
 * refusing it — is a DATABASE change (`docs/scan-limit-l1.md`). This module is
 * written to the status set that change will produce (`reused`, `held`) so the
 * handler is already correct when it lands, but nothing here mints, holds or
 * counts anything: it only decides what the response to a given answer is.
 */

/** Every status `open_table_session` can return, now or under L1. */
export type ScanStatus =
  | 'opened'
  | 'reused'
  | 'held'
  | 'limited'
  | 'code'
  | 'revoked'
  | 'notserving'
  | 'nomenu'
  | 'unreadable';

export type ScanOutcome = {
  /**
   * Whether the answer carries a usable session token that the response should
   * store. False means the guest keeps browsing without one — never that they
   * are blocked from reading the menu.
   */
  keepSession: boolean;
  /**
   * Why the guest has no session, when they have none. This is what a screen
   * needs in order to say something true; `null` means "nothing to explain".
   */
  reason: 'throttled' | 'code-mode' | 'card' | 'closed' | 'empty' | null;
  /**
   * Whether the visit is expected to end in an order or not. Used by the tests
   * and by callers that want to log a genuine anomaly rather than the ordinary
   * `code` answer.
   */
  expectOrder: boolean;
};

/**
 * The closed set, one row per status.
 *
 * `limited` is the only row that means "this guest cannot order right now", and
 * it is the only one that must ever produce a sentence a guest can act on. In
 * the CURRENT database it cannot lead to an order because no session is minted;
 * under L1 it stops being reachable until the held budget is also spent, and it
 * carries a retry time.
 */
const OUTCOMES: Record<ScanStatus, ScanOutcome> = {
  // A session was minted for this scan. Ordering works.
  opened: { keepSession: true, reason: null, expectOrder: true },
  // L1: an existing live session was reused; nothing was minted or counted.
  reused: { keepSession: true, reason: null, expectOrder: true },
  // L1: minted, but every order of this sitting waits for one staff tap.
  held: { keepSession: true, reason: null, expectOrder: true },
  // The card or this address has been opened too often this hour.
  limited: { keepSession: false, reason: 'throttled', expectOrder: false },
  // The restaurant wants digits. Not an error: checkout asks for them.
  code: { keepSession: false, reason: 'code-mode', expectOrder: true },
  revoked: { keepSession: false, reason: 'card', expectOrder: false },
  notserving: { keepSession: false, reason: 'closed', expectOrder: false },
  nomenu: { keepSession: false, reason: 'empty', expectOrder: false },
  unreadable: { keepSession: false, reason: 'card', expectOrder: false },
};

/**
 * The reservation: an unknown word must never be read as "you may order".
 *
 * A status this file has not been told about can only come from a database that
 * is newer than this build, so the honest handling is the one that grants
 * nothing and explains nothing — the pre-existing behaviour — rather than
 * guessing that it was a success.
 */
const RESERVED: ScanOutcome = { keepSession: false, reason: null, expectOrder: false };

export function scanOutcome(status: string | null | undefined): ScanOutcome {
  if (!status) return RESERVED;
  return (OUTCOMES as Record<string, ScanOutcome>)[status] ?? RESERVED;
}

/**
 * The one sentence a throttled guest is owed.
 *
 * WHY THIS EXISTS BEFORE THE BEHAVIOUR DOES
 *
 * Today `limited` is silent: the guest is sent to the menu and finds out at
 * checkout that ordering is impossible, with nothing to explain it and, in a
 * scan-mode restaurant, no code to enter. Whatever L1 decides, that sentence
 * has to exist — so it is here, with its retry arithmetic tested, waiting for a
 * caller. `retryAfterSeconds` is optional because the current
 * `open_table_session` does not return one; L1 adds it to the return table, and
 * this function already knows what to do with it.
 */
export function throttleNotice(retryAfterSeconds?: number | null): string {
  const retry = formatRetry(retryAfterSeconds);
  return retry
    ? `This table has been scanned unusually often in the last hour. Ordering is paused for ${retry} — your cart is safe. You can also order with staff.`
    : 'This table has been scanned unusually often in the last hour. Ordering is paused for a short while — your cart is safe. You can also order with staff.';
}

/**
 * A duration a person can act on, rounded so it cannot be wrong.
 *
 * Minutes are rounded UP and never below one: telling somebody "try again in 0
 * minutes" is worse than telling them "one minute". Absent, zero or nonsense
 * input produces no estimate rather than a fabricated one.
 */
export function formatRetry(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return 'about a minute';
  if (minutes >= 60) return 'about an hour';
  return `about ${minutes} minutes`;
}

/* ------------------------------------------------------------------ the flag */

/**
 * How a throttle survives the redirect.
 *
 * A scan answers with the menu URL, so there is nowhere else to put the answer.
 * Two carriers, because they do two different jobs:
 *
 *   `?v=throttled`      the first screen after the scan. It is in the address,
 *                       so it survives a hard refresh and can be shared.
 *   `autodine_throttled` every screen after that — the item sheet, the cart,
 *                       the checkout. Without it a guest who was throttled at
 *                       the door would be told again at checkout that they need
 *                       a code, in a restaurant that has none.
 *
 * THE COOKIE GRANTS NOTHING. It is read for copy and for nothing else, and it
 * cannot become a session: `place_public_order` still refuses without one, and
 * the only function that mints one is the one that just refused. A guest who
 * edited it would change what a sentence says, not what they are allowed to do.
 */
export const THROTTLE_PARAM = 'v';
export const THROTTLE_VALUE = 'throttled';
export const THROTTLE_COOKIE = 'autodine_throttled';

/**
 * Fifteen minutes: long enough to cover a guest who takes a while over the
 * menu, short enough that the guest who comes back after the queue has cleared
 * is not still being told about a limit that may no longer apply.
 */
export const THROTTLE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 15,
};

/**
 * The wait the DATABASE reported, if it reported one.
 *
 * `open_table_session` returns five columns and none of them is a wait time, so
 * today this always returns null and every screen says "a short while". It is
 * read anyway, under both spellings an L1 return table might use, because the
 * alternative is that the day the database starts telling us the wait, the app
 * ignores it — and a guest is told "a short while" when the server knew the
 * number.
 *
 * Sanitised here rather than trusted: it is a number written into copy, and a
 * negative, fractional or absurd value would produce either "in about -3
 * minutes" or a wall of text. One day is the cap; a longer wait is a staff
 * problem, not a retry hint.
 */
export function readRetryAfter(row: Record<string, unknown> | undefined | null): number | null {
  if (!row) return null;
  const raw = row['retry_after_seconds'] ?? row['retry_after'];
  const seconds = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const rounded = Math.ceil(seconds);
  if (rounded < 1 || rounded > 86_400) return null;
  return rounded;
}

/**
 * How the flag is written: `throttled`, or `throttled.600` when the server said
 * how long.
 *
 * The wait travels in the SAME value rather than a second cookie, so the two
 * can never disagree: there is no state where a guest is told they were
 * throttled but the number is missing, or where a stale number outlives the
 * flag it belongs to.
 */
export function throttleFlag(retryAfterSeconds?: number | null): string {
  const seconds = readRetryAfter({ retry_after_seconds: retryAfterSeconds });
  return seconds ? `${THROTTLE_VALUE}.${seconds}` : THROTTLE_VALUE;
}

export type ThrottleFlag = {
  /** Was this request turned away at the door? */
  throttled: boolean;
  /** The wait the server reported, in seconds, when it reported one. */
  retryAfterSeconds: number | null;
};

/**
 * Read a flag that came from a URL or a cookie, so from the guest.
 *
 * Anything that is not exactly `throttled` or `throttled.<1..86400>` is not a
 * throttle — including a longer suffix, a negative one, or `throttled.600.1`.
 */
export function readThrottleFlag(value: string | null | undefined): ThrottleFlag {
  if (typeof value !== 'string') return { throttled: false, retryAfterSeconds: null };
  if (value === THROTTLE_VALUE) return { throttled: true, retryAfterSeconds: null };
  if (!value.startsWith(`${THROTTLE_VALUE}.`)) return { throttled: false, retryAfterSeconds: null };
  // The word is the note; the suffix is only a number. An unusable number is
  // dropped and the note kept, so a guest who edits the cookie loses the
  // estimate and not the explanation — and a negative or absurd wait can never
  // reach a sentence. Nothing is granted either way: the flag decides copy, and
  // the order path still refuses without a session.
  return {
    throttled: true,
    retryAfterSeconds: readRetryAfter({ retry_after_seconds: value.slice(THROTTLE_VALUE.length + 1) }),
  };
}

/** Is this request one that was throttled at the door? */
export function isThrottled(value: string | null | undefined): boolean {
  return readThrottleFlag(value).throttled;
}

/**
 * What a throttled guest is told when they have already built a cart.
 *
 * The menu banner can afford to be brief; this one cannot, because it arrives
 * after the guest pressed Place order and the first thing they need to know is
 * that NOTHING WAS SENT — not that something was saved and is waiting. Then
 * what to do, then where their cart is. In that order, because that is the
 * order a person reads it.
 */
export function notPlacedNotice(retryAfterSeconds?: number | null): string {
  const retry = formatRetry(retryAfterSeconds);
  const when = retry ? `in ${retry}` : 'in a few minutes';
  return `Your order was not sent. This table was checked unusually often in the last hour, so ordering is paused — try again ${when}, or order with our staff. Your cart is safe and nothing has been charged.`;
}
