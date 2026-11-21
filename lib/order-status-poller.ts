/**
 * The engine that keeps a guest's order status fresh.
 *
 * WHY NOT SUPABASE REALTIME
 *
 * Realtime needs a browser client holding the anon key and a read policy on
 * public.orders for that role. There is deliberately no such policy: a guest is
 * not signed in, and the only way they may read an order is through
 * get_public_order(), which requires the order's own unguessable token. Opening
 * `orders` to `anon` so a subscription can work would mean any visitor can
 * subscribe to every restaurant's feed -- a tenant-isolation hole traded for a
 * few seconds of latency. So this polls, and the polling is designed to be
 * cheap and honest instead.
 *
 * WHAT IT GUARANTEES
 *
 *   - ONE request at a time. A poll that is already in flight is not doubled by
 *     a visibility change or a second mount.
 *   - NOTHING while the tab is hidden: an order page left open on a locked
 *     phone does not spend the restaurant's database.
 *   - An immediate read when the guest comes back, because that is the moment
 *     they are looking again.
 *   - SLOWING DOWN when the network is failing (2s, 5s, 10s, 20s, 30s, then a
 *     minute), and an immediate retry when the browser says it is online again.
 *     A tight retry loop on a dead connection is how a guest's battery dies and
 *     how a small restaurant's free-tier quota does.
 *   - STOPPING at a terminal status. Served and cancelled will not change, and
 *     a page that keeps asking is a page that keeps paying for the answer.
 *
 * WHY IT IS NOT A REACT HOOK
 *
 * Timers and visibility are the parts that actually go wrong, and a hook can
 * only be tested with a browser. This is a plain factory with its clock, timer
 * and fetch injected, so every one of the behaviours above has a test that runs
 * in a second without one. components/GuestLiveStatus.tsx is the thin React
 * wrapper, and holds no scheduling logic of its own.
 */

import {
  guestStatus,
  parseOrderStatusSnapshot,
  type GuestStatusKey,
  type OrderStatusSnapshot,
} from '@/lib/guest-order-status';

export type PollerPhase =
  /** Nothing has been asked yet. */
  | 'idle'
  /** First read in flight, nothing on screen yet. */
  | 'checking'
  /** The last read succeeded; the loop is healthy. */
  | 'live'
  /** The last read failed; retrying with a widening gap. */
  | 'reconnecting'
  /** Finished: terminal status, missing order, or stopped by the owner. */
  | 'stopped';

export type PollerState = {
  phase: PollerPhase;
  /** Consecutive failed reads. Resets on the first success. */
  failures: number;
  /** Server time of the last successful read, or null. */
  lastOkAt: number | null;
};

export type PollIntervals = {
  /** Between reads while the tab is visible and the order is moving. */
  active: number;
  /** After 1st, 2nd, 3rd... consecutive failure. Last value repeats. */
  backoff: readonly number[];
};

/**
 * Ten seconds while a meal is being cooked is fast enough to feel live and slow
 * enough that a hundred open tabs are not a hundred queries a second. The
 * kitchen board itself polls at five.
 */
export const DEFAULT_INTERVALS: PollIntervals = {
  active: 10_000,
  backoff: [2_000, 5_000, 10_000, 20_000, 30_000, 60_000],
};

export type PollerDeps = {
  /** One read. Resolves null when the server says the order does not exist. */
  request: () => Promise<unknown>;
  /** Injectable clock, so tests do not wait. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** True while the tab is hidden. */
  isHidden?: () => boolean;
  onSnapshot: (snapshot: OrderStatusSnapshot) => void;
  /** The server answered, and the order is not there (any more). */
  onMissing?: () => void;
  onState?: (state: PollerState) => void;
  intervals?: Partial<PollIntervals>;
};

export type StatusPoller = {
  /** Idempotent: a second call does not start a second loop. */
  start: () => void;
  stop: () => void;
  /** Read now, if nothing is already in flight. Used when the tab reappears. */
  pollNow: () => void;
  getState: () => PollerState;
};

export function createStatusPoller(deps: PollerDeps): StatusPoller {
  const now = deps.now ?? (() => Date.now());
  const setTimer =
    deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const clearTimer = deps.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const isHidden = deps.isHidden ?? (() => false);
  const intervals: PollIntervals = { ...DEFAULT_INTERVALS, ...deps.intervals };

  let running = false;
  let inFlight = false;
  let timer: unknown = null;
  let state: PollerState = { phase: 'idle', failures: 0, lastOkAt: null };

  const emit = (next: Partial<PollerState>) => {
    state = { ...state, ...next };
    deps.onState?.(state);
  };

  const clear = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const schedule = (ms: number) => {
    clear();
    if (!running) return;
    timer = setTimer(() => {
      timer = null;
      void tick();
    }, ms);
  };

  const failureDelay = (failures: number): number => {
    const list = intervals.backoff;
    const index = Math.min(Math.max(failures - 1, 0), list.length - 1);
    return list[index] ?? intervals.active;
  };

  async function tick(): Promise<void> {
    if (!running) return;

    /* Hidden: ask nothing, and schedule nothing. The loop goes dormant rather
       than dripping; the wrapper calls pollNow() when the tab comes back, which
       is the only moment the answer is being looked at. An order page left open
       overnight therefore costs zero requests after the first minute. */
    if (isHidden()) return;

    // One request at a time. The in-flight read will schedule the next.
    if (inFlight) return;

    inFlight = true;
    emit({
      phase: state.lastOkAt === null && state.failures === 0 ? 'checking' : 'live',
    });

    try {
      const raw = await deps.request();
      const snapshot = parseOrderStatusSnapshot(raw);

      if (raw === null) {
        // The order is gone (deleted, or the token no longer matches).
        running = false;
        clear();
        emit({ phase: 'stopped' });
        deps.onMissing?.();
        return;
      }

      if (!snapshot) {
        // A 200 with a body we do not understand: treat it as a failed read,
        // never as an empty status. The screen keeps what it last saw.
        throw new Error('unreadable status payload');
      }

      deps.onSnapshot(snapshot);
      emit({ phase: 'live', failures: 0, lastOkAt: Date.parse(snapshot.checkedAt) || now() });

      if (guestStatus({ prepStatus: snapshot.status, awaitingConfirmation: snapshot.awaitingConfirmation }).terminal) {
        running = false;
        clear();
        emit({ phase: 'stopped' });
        return;
      }

      schedule(intervals.active);
    } catch {
      const failures = state.failures + 1;
      emit({ phase: 'reconnecting', failures });
      schedule(failureDelay(failures));
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      emit({ phase: state.lastOkAt === null ? 'checking' : 'live' });
      schedule(0);
    },
    stop() {
      running = false;
      clear();
      emit({ phase: 'stopped' });
    },
    pollNow() {
      if (!running) return;
      if (inFlight) return;
      if (isHidden()) return;
      schedule(0);
    },
    getState() {
      return state;
    },
  };
}

/**
 * The status key the screen is showing, for tests and for the stale guard.
 * Kept here so callers do not re-derive it from a snapshot differently.
 */
export function keyOf(snapshot: OrderStatusSnapshot | null): GuestStatusKey {
  if (!snapshot) return 'unknown';
  return guestStatus({
    prepStatus: snapshot.status,
    awaitingConfirmation: snapshot.awaitingConfirmation,
  }).key;
}
