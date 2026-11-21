import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatusPoller, type PollerState } from './order-status-poller';
import type { OrderStatusSnapshot } from './guest-order-status';

/**
 * The poller, with time under the test's control.
 *
 * Every behaviour here is one that has actually gone wrong in products like
 * this one: two requests for one status, a retry loop that hammers a dead
 * network, a poll that keeps running after the food has arrived, a page that
 * spends a restaurant's free-tier quota while sitting in a background tab.
 */

type Timer = { fn: () => void; ms: number; id: number };

function harness(options: {
  answers: Array<unknown | Error>;
  hidden?: boolean;
}) {
  const timers: Timer[] = [];
  let nextId = 1;
  let hidden = options.hidden ?? false;
  const states: PollerState[] = [];
  const snapshots: OrderStatusSnapshot[] = [];
  let missing = 0;
  let requests = 0;

  let index = 0;
  const request = vi.fn(async () => {
    requests += 1;
    const answer = options.answers[Math.min(index, options.answers.length - 1)];
    index += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  });

  const poller = createStatusPoller({
    request,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ fn, ms, id });
      return id;
    },
    clearTimer: (id) => {
      const at = timers.findIndex((timer) => timer.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
    isHidden: () => hidden,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onMissing: () => (missing += 1),
    onState: (state) => states.push({ ...state }),
  });

  /** Run the next queued timer, letting the promise chain settle. */
  const fire = async () => {
    const next = timers.shift();
    if (!next) throw new Error('no timer was scheduled');
    next.fn();
    // Two microtask turns: the await inside tick() plus the finally.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  return {
    poller,
    timers,
    states,
    snapshots,
    request,
    fire,
    get requests() {
      return requests;
    },
    get missing() {
      return missing;
    },
    get lastState() {
      return states[states.length - 1];
    },
    setHidden(value: boolean) {
      hidden = value;
    },
  };
}

const snapshot = (status: string, awaitingConfirmation = false): OrderStatusSnapshot => ({
  status,
  awaitingConfirmation,
  paymentStatus: 'pending',
  placedAt: '2026-10-26T10:00:00.000Z',
  checkedAt: new Date().toISOString(),
});

let harnessCount = 0;
beforeEach(() => {
  harnessCount += 1;
  expect(harnessCount).toBeGreaterThan(0);
});

describe('the first read', () => {
  it('asks once, immediately, and draws what came back', async () => {
    const h = harness({ answers: [snapshot('preparing')] });
    h.poller.start();
    await h.fire();

    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.snapshots).toHaveLength(1);
    expect(h.lastState.phase).toBe('live');
    expect(h.lastState.failures).toBe(0);
  });

  it('is not started twice by a second mount', async () => {
    const h = harness({ answers: [snapshot('preparing')] });
    h.poller.start();
    h.poller.start();
    await h.fire();

    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.timers).toHaveLength(1);
  });
});

describe('while the order is moving', () => {
  it('polls on the active interval and never overlaps requests', async () => {
    const h = harness({ answers: [snapshot('preparing'), snapshot('preparing'), snapshot('ready')] });
    h.poller.start();
    await h.fire();

    // A visibility change arrives while the next poll is queued: one timer.
    h.poller.pollNow();
    h.poller.pollNow();
    expect(h.timers.filter((timer) => timer.ms === 0)).toHaveLength(1);

    await h.fire();
    await h.fire();

    expect(h.request).toHaveBeenCalledTimes(3);
    expect(h.snapshots.map((s) => s.status)).toEqual(['preparing', 'preparing', 'ready']);
  });

  it('stops asking once the order is served', async () => {
    const h = harness({ answers: [snapshot('served')] });
    h.poller.start();
    await h.fire();

    expect(h.lastState.phase).toBe('stopped');
    expect(h.timers).toHaveLength(0);

    // And a late visibility change cannot restart it.
    h.poller.pollNow();
    expect(h.timers).toHaveLength(0);
    expect(h.request).toHaveBeenCalledTimes(1);
  });

  it('stops asking once the order is cancelled', async () => {
    const h = harness({ answers: [snapshot('cancelled')] });
    h.poller.start();
    await h.fire();

    expect(h.lastState.phase).toBe('stopped');
    expect(h.timers).toHaveLength(0);
  });

  it('keeps asking while the order is still held for confirmation', async () => {
    const h = harness({ answers: [snapshot('new', true)] });
    h.poller.start();
    await h.fire();

    expect(h.lastState.phase).toBe('live');
    expect(h.timers).toHaveLength(1);
  });
});

describe('a tab nobody is looking at', () => {
  it('asks nothing at all, and schedules nothing', async () => {
    const h = harness({ answers: [snapshot('preparing')], hidden: true });
    h.poller.start();
    await h.fire();

    expect(h.request).toHaveBeenCalledTimes(0);
    expect(h.timers).toHaveLength(0);
  });

  it('reads again the moment the tab comes back', async () => {
    const h = harness({ answers: [snapshot('preparing')], hidden: true });
    h.poller.start();
    await h.fire();

    h.setHidden(false);
    h.poller.pollNow();
    await h.fire();

    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.snapshots).toHaveLength(1);
  });
});

describe('when the network fails', () => {
  it('backs off instead of hammering, then recovers', async () => {
    const h = harness({
      answers: [new Error('offline'), new Error('offline'), new Error('offline'), snapshot('ready')],
    });
    h.poller.start();
    await h.fire();

    expect(h.lastState).toMatchObject({ phase: 'reconnecting', failures: 1 });
    expect(h.timers[0].ms).toBe(2_000);

    await h.fire();
    expect(h.lastState.failures).toBe(2);
    expect(h.timers[0].ms).toBe(5_000);

    await h.fire();
    expect(h.timers[0].ms).toBe(10_000);

    await h.fire();
    expect(h.lastState).toMatchObject({ phase: 'live', failures: 0 });
    expect(h.snapshots).toHaveLength(1);
  });

  it('caps the wait instead of growing without limit', async () => {
    const h = harness({ answers: [new Error('offline')] });
    h.poller.start();

    const waits: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      await h.fire();
      waits.push(h.timers[0].ms);
    }

    expect(waits).toEqual([2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 60_000, 60_000]);
  });

  it('keeps the last known status rather than clearing the screen', async () => {
    const h = harness({ answers: [snapshot('preparing'), new Error('offline')] });
    h.poller.start();
    await h.fire();
    await h.fire();

    // One snapshot: a failed read reports a phase, never an empty status.
    expect(h.snapshots).toHaveLength(1);
    expect(h.snapshots[0].status).toBe('preparing');
    expect(h.lastState.phase).toBe('reconnecting');
  });

  it('treats an unreadable body as a failed read, not as a status', async () => {
    const h = harness({ answers: [snapshot('preparing'), { hello: 'world' }] });
    h.poller.start();
    await h.fire();
    await h.fire();

    expect(h.snapshots.map((s) => s.status)).toEqual(['preparing']);
    expect(h.lastState.phase).toBe('reconnecting');
  });
});

describe('an order that is not there', () => {
  it('stops and says so, rather than retrying forever', async () => {
    const h = harness({ answers: [null] });
    h.poller.start();
    await h.fire();

    expect(h.missing).toBe(1);
    expect(h.lastState.phase).toBe('stopped');
    expect(h.timers).toHaveLength(0);
    expect(h.snapshots).toHaveLength(0);
  });
});

describe('stopping', () => {
  it('leaves no timer behind', async () => {
    const h = harness({ answers: [snapshot('preparing')] });
    h.poller.start();
    await h.fire();

    h.poller.stop();
    expect(h.timers).toHaveLength(0);
    expect(h.lastState.phase).toBe('stopped');
  });
});
