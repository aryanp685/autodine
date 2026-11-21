/**
 * What a guest is told about their order, in one place.
 *
 * THE STATES ARE THE DATABASE'S, NOT OURS
 *
 * `orders.prep_status` allows exactly five values -- new, preparing, ready,
 * served, cancelled -- and a held order carries a sixth fact, `confirmed_at`,
 * which is null until a person on the floor has vouched for the table. This
 * module turns those into the six things a guest can actually be told:
 *
 *   pending              placed, but nobody has confirmed the table yet
 *   confirmed            accepted, in the kitchen queue, not started
 *   preparing            being cooked
 *   ready                plated, on its way
 *   served               at the table
 *   cancelled            nothing is being cooked and nothing is owed
 *
 * There is no seventh state and no invented one: anything the schema does not
 * recognise becomes `unknown`, which the UI renders as "we cannot read this"
 * rather than guessing a position on a progress track.
 *
 * WHY THIS IS PURE
 *
 * The same mapping decides (a) what the guest reads, (b) whether the poller
 * keeps running, and (c) whether an arriving status may replace the one on
 * screen. Three consumers that must never disagree. It has no React, no
 * network and no clock of its own, so all three can be tested without either.
 */

/** The five values `orders.prep_status` can hold, plus what we add for safety. */
export type GuestStatusKey =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'cancelled'
  | 'unknown';

export type GuestStatusTone =
  /** Waiting on somebody else: the restaurant has not picked it up yet. */
  | 'wait'
  /** In progress: something is happening right now. */
  | 'live'
  /** Finished, and true. */
  | 'done'
  /** Nothing will happen again. */
  | 'stopped'
  /** We could not read a status we understand. */
  | 'unknown';

export type GuestStatus = {
  key: GuestStatusKey;
  /** Two or three words: the badge. */
  label: string;
  /** One sentence, present tense, true right now. */
  headline: string;
  /** What happens next, or what to do. Never a promise we cannot keep. */
  detail: string;
  tone: GuestStatusTone;
  /** True when polling must stop: nothing further can change. */
  terminal: boolean;
  /** Position in the order's life, for the progress track and for stale-guarding. */
  rank: number;
};

type StatusCopy = Omit<GuestStatus, 'key' | 'terminal' | 'rank'>;

const COPY: Record<Exclude<GuestStatusKey, 'unknown'>, StatusCopy> = {
  pending: {
    label: 'Waiting for the restaurant',
    headline: 'Your order has reached the restaurant and is waiting for a staff member to confirm the table.',
    detail: 'Nothing is cooking yet. This updates by itself the moment they confirm — no need to reload.',
    tone: 'wait',
  },
  confirmed: {
    label: 'Confirmed',
    headline: 'The restaurant has your order and it is in the kitchen queue.',
    detail: 'Cooking has not started yet. This page updates by itself as the kitchen works.',
    tone: 'wait',
  },
  preparing: {
    label: 'Being cooked',
    headline: 'The kitchen is cooking your order now.',
    detail: 'It will show as ready to serve the moment it is plated.',
    tone: 'live',
  },
  ready: {
    label: 'Ready to serve',
    headline: 'Your order is ready and on its way to the table.',
    detail: 'If nobody has brought it in a couple of minutes, ask the staff with your reference.',
    tone: 'live',
  },
  served: {
    label: 'Served',
    headline: 'Your order has been served.',
    detail: 'Enjoy it. The bill is settled at the counter when you are ready.',
    tone: 'done',
  },
  cancelled: {
    label: 'Cancelled',
    headline: 'This order was cancelled. Nothing is being cooked and nothing is owed.',
    detail: 'Order again from the menu whenever you are ready.',
    tone: 'stopped',
  },
};

/** Life position. Cancellation is outside the ladder: it can arrive at any step. */
const RANK: Record<Exclude<GuestStatusKey, 'unknown'>, number> = {
  pending: 1,
  confirmed: 2,
  preparing: 3,
  ready: 4,
  served: 5,
  cancelled: 99,
};

const UNKNOWN: GuestStatus = {
  key: 'unknown',
  label: 'Status unavailable',
  headline: 'We could not read a status this app understands for this order.',
  detail: 'Your order is not lost — the staff can always find it by the reference. Ask them if you need to check.',
  tone: 'unknown',
  terminal: false,
  rank: 0,
};

/**
 * Map the database's answer onto what the guest reads.
 *
 * `awaitingConfirmation` wins over `new`: a held order is `new` in the table
 * because nothing has started, and calling that "confirmed" would be the one
 * dishonest sentence this screen could write.
 */
export function guestStatus(input: {
  prepStatus: string;
  awaitingConfirmation?: boolean;
}): GuestStatus {
  const prep = (input.prepStatus ?? '').trim().toLowerCase();

  if (input.awaitingConfirmation === true && prep !== 'cancelled') {
    return {
      key: 'pending',
      ...COPY.pending,
      terminal: false,
      rank: RANK.pending,
    };
  }

  switch (prep) {
    case 'new':
      return { key: 'confirmed', ...COPY.confirmed, terminal: false, rank: RANK.confirmed };
    case 'preparing':
      return { key: 'preparing', ...COPY.preparing, terminal: false, rank: RANK.preparing };
    case 'ready':
      return { key: 'ready', ...COPY.ready, terminal: false, rank: RANK.ready };
    case 'served':
      return { key: 'served', ...COPY.served, terminal: true, rank: RANK.served };
    case 'cancelled':
      return { key: 'cancelled', ...COPY.cancelled, terminal: true, rank: RANK.cancelled };
    default:
      return UNKNOWN;
  }
}

/** True when nothing further can change, so a poller may stop. */
export function isTerminalStatus(input: {
  prepStatus: string;
  awaitingConfirmation?: boolean;
}): boolean {
  return guestStatus(input).terminal;
}

/**
 * May `next` replace `current`?
 *
 * WHAT THIS PREVENTS
 *
 * Two reads in flight at once (a slow one and a fast one) can arrive out of
 * order, and a cached proxy response can be older than the screen. Without a
 * rule, the guest watches "Ready to serve" flip back to "Being cooked" -- on a
 * page whose whole job is to be trusted about where the food is.
 *
 * THE RULE
 *
 *   - A cancelled order always wins; cancellation can happen at any step.
 *   - A status further along the ladder always wins.
 *   - The same status is a refresh, not a change: accepted, so "checked just
 *     now" keeps moving.
 *   - Anything earlier is ignored. `unknown` never beats a known status, and a
 *     known status always replaces `unknown` (a transient read failure must not
 *     pin the screen to "unavailable" forever).
 */
export function mayReplaceStatus(current: GuestStatusKey, next: GuestStatusKey): boolean {
  if (next === 'unknown') return current === 'unknown';
  if (current === 'unknown') return true;
  if (next === 'cancelled') return current !== 'cancelled';
  if (next === 'pending') {
    // Back to "waiting for confirmation" only from nothing: a held order is the
    // first thing a scan-mode restaurant shows, never a step it returns to.
    return current === 'pending';
  }
  return RANK[next] >= RANK[current];
}

/**
 * One status payload, exactly as the server sends it.
 *
 * `checkedAt` is the SERVER's clock. A guest's phone can be minutes out, and a
 * "checked 4 minutes ago" computed from a wrong clock is a lie about freshness.
 */
export type OrderStatusSnapshot = {
  status: string;
  awaitingConfirmation: boolean;
  paymentStatus: string;
  placedAt: string;
  checkedAt: string;
};

/**
 * Validate what came back over the wire.
 *
 * The endpoint is ours, but a captive-portal HTML page, a proxy error and a
 * half-written body all arrive here too. Returning null for anything unexpected
 * means the screen keeps the last status it actually saw rather than printing a
 * parse error at a guest.
 */
export function parseOrderStatusSnapshot(value: unknown): OrderStatusSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;

  const status = typeof row.status === 'string' ? row.status.trim() : '';
  if (!status) return null;

  const checkedAt = typeof row.checkedAt === 'string' ? row.checkedAt : '';
  if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) return null;

  return {
    status,
    awaitingConfirmation: row.awaitingConfirmation === true,
    paymentStatus: typeof row.paymentStatus === 'string' ? row.paymentStatus : 'pending',
    placedAt: typeof row.placedAt === 'string' ? row.placedAt : '',
    checkedAt,
  };
}

/** How long ago a status was checked, in words. Never invents a freshness. */
export function checkedAgo(checkedAt: string, nowMs: number): string {
  const at = Date.parse(checkedAt);
  if (Number.isNaN(at)) return 'just now';

  const seconds = Math.max(0, Math.round((nowMs - at) / 1000));
  if (seconds < 15) return 'just now';
  if (seconds < 45) return `${seconds} seconds ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}
