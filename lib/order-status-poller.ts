/** One visibility-aware scoped status read at a time, with bounded retries. */
import { revisionNumber } from '@/lib/realtime-revisions';
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

export const DEFAULT_INTERVALS: PollIntervals = {
  active: 3_000,
  backoff: [2_000, 5_000, 10_000, 20_000, 30_000, 60_000],
};

export type PollerDeps = {
  /** One read. Resolves null when the server says the order does not exist. */
  request: (signal: AbortSignal) => Promise<unknown>;
  /** Injectable clock, so tests do not wait. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** True while the tab is hidden. */
  isHidden?: () => boolean;
  onSnapshot: (snapshot: OrderStatusSnapshot) => void;
  /** On the bill, served is not settled. Prep-only views can stop at served. */
  watchPayment?: boolean;
  /** Detail view must retry even a terminal invalidation until props catch up. */
  stopAtTerminal?: boolean;
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
  let inFlight: AbortController | null = null;
  let observed: bigint | null = null;
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

    const controller = new AbortController();
    inFlight = controller;
    emit({
      phase: state.lastOkAt === null && state.failures === 0 ? 'checking' : 'live',
    });

    try {
      const raw = await deps.request(controller.signal);
      if (!running || controller.signal.aborted) return;
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

      const version = revisionNumber(snapshot.revision);
      if (observed !== null && (version === null || version < observed)) {
        schedule(intervals.active);
        return;
      }
      observed = version;
      deps.onSnapshot(snapshot);
      emit({ phase: 'live', failures: 0, lastOkAt: Date.parse(snapshot.checkedAt) || now() });

      const status = guestStatus({ prepStatus: snapshot.status, awaitingConfirmation: snapshot.awaitingConfirmation });
      if (deps.stopAtTerminal !== false && status.terminal && !(deps.watchPayment && status.key === 'served' && snapshot.paymentStatus === 'pending')) {
        running = false;
        clear();
        emit({ phase: 'stopped' });
        return;
      }

      schedule(intervals.active);
    } catch {
      if (!running || controller.signal.aborted) return;
      const failures = state.failures + 1;
      emit({ phase: 'reconnecting', failures });
      schedule(failureDelay(failures));
    } finally {
      if (inFlight === controller) inFlight = null;
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
      inFlight?.abort();
      inFlight = null;
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
