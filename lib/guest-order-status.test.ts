import { describe, expect, it } from 'vitest';
import {
  checkedAgo,
  guestStatus,
  isTerminalStatus,
  mayReplaceStatus,
  parseOrderStatusSnapshot,
  type GuestStatusKey,
} from './guest-order-status';

/**
 * The mapping the guest reads, and the rule that stops the screen going
 * backwards.
 *
 * The five prep states are the database's own CHECK constraint; `pending` is
 * the held-order fact (hold_required and no confirmed_at). A test that invented
 * a sixth state would be testing a product that does not exist.
 */

describe('what each database status says to a guest', () => {
  it('never calls a held order confirmed', () => {
    const status = guestStatus({ prepStatus: 'new', awaitingConfirmation: true });
    expect(status.key).toBe('pending');
    expect(status.headline).toMatch(/waiting for a staff member to confirm/i);
    // The word that would be a lie: nothing is cooking while it is held.
    expect(status.headline).not.toMatch(/cooking has started|in the kitchen queue/i);
  });

  it('says confirmed only once the order is really in the queue', () => {
    const status = guestStatus({ prepStatus: 'new', awaitingConfirmation: false });
    expect(status.key).toBe('confirmed');
    expect(status.headline).toMatch(/in the kitchen queue/i);
  });

  it('maps the other three states one to one', () => {
    expect(guestStatus({ prepStatus: 'preparing' }).key).toBe('preparing');
    expect(guestStatus({ prepStatus: 'ready' }).key).toBe('ready');
    expect(guestStatus({ prepStatus: 'served' }).key).toBe('served');
    expect(guestStatus({ prepStatus: 'cancelled' }).key).toBe('cancelled');
  });

  it('is case- and whitespace-tolerant, because it reads a text column', () => {
    expect(guestStatus({ prepStatus: ' Preparing ' }).key).toBe('preparing');
  });

  it('a cancelled order is never described as cooking or in the queue', () => {
    const cancelled = guestStatus({ prepStatus: 'cancelled', awaitingConfirmation: true });
    expect(cancelled.key).toBe('cancelled');
    expect(cancelled.detail).toMatch(/order again/i);
    // Cancelled wins over the held flag: the order is not waiting for anybody.
    expect(cancelled.key).not.toBe('pending');
  });

  it('does not invent a position for a status it does not know', () => {
    const unknown = guestStatus({ prepStatus: 'refunded' });
    expect(unknown.key).toBe('unknown');
    expect(unknown.rank).toBe(0);
    expect(unknown.terminal).toBe(false);
    expect(unknown.detail).toMatch(/staff can always find it/i);
  });
});

describe('which statuses end the poll', () => {
  it('stops at served and cancelled', () => {
    expect(isTerminalStatus({ prepStatus: 'served' })).toBe(true);
    expect(isTerminalStatus({ prepStatus: 'cancelled' })).toBe(true);
  });

  it('keeps polling for everything the kitchen can still change', () => {
    for (const status of ['new', 'preparing', 'ready']) {
      expect(isTerminalStatus({ prepStatus: status }), status).toBe(false);
    }
    expect(isTerminalStatus({ prepStatus: 'new', awaitingConfirmation: true })).toBe(false);
  });
});

describe('a status may not go backwards', () => {
  const ladder: GuestStatusKey[] = ['pending', 'confirmed', 'preparing', 'ready', 'served'];

  it('accepts every forward move', () => {
    for (let i = 0; i < ladder.length - 1; i += 1) {
      expect(mayReplaceStatus(ladder[i], ladder[i + 1]), `${ladder[i]} -> ${ladder[i + 1]}`).toBe(true);
    }
  });

  it('refuses every backward move', () => {
    for (let i = ladder.length - 1; i > 0; i -= 1) {
      expect(mayReplaceStatus(ladder[i], ladder[i - 1]), `${ladder[i]} -> ${ladder[i - 1]}`).toBe(false);
    }
  });

  it('lets a cancellation arrive at any step, and lets nothing undo it', () => {
    expect(mayReplaceStatus('preparing', 'cancelled')).toBe(true);
    expect(mayReplaceStatus('ready', 'cancelled')).toBe(true);
    expect(mayReplaceStatus('cancelled', 'served')).toBe(false);
    expect(mayReplaceStatus('cancelled', 'cancelled')).toBe(false);
  });

  it('treats the same status again as a refresh', () => {
    expect(mayReplaceStatus('preparing', 'preparing')).toBe(true);
  });

  it('does not let a failed read erase a known status', () => {
    expect(mayReplaceStatus('ready', 'unknown')).toBe(false);
    // ...but a real status does replace a failed one, so the screen recovers.
    expect(mayReplaceStatus('unknown', 'ready')).toBe(true);
  });

  it('can never go back to "waiting for the restaurant"', () => {
    expect(mayReplaceStatus('confirmed', 'pending')).toBe(false);
  });
});

describe('reading the endpoint’s payload', () => {
  const good = {
    status: 'preparing',
    awaitingConfirmation: false,
    paymentStatus: 'pending',
    placedAt: '2026-10-26T10:00:00.000Z',
    checkedAt: '2026-10-26T10:01:00.000Z',
  };

  it('accepts a complete answer', () => {
    expect(parseOrderStatusSnapshot(good)).toEqual(good);
  });

  it('refuses anything without a status or a server clock', () => {
    expect(parseOrderStatusSnapshot(null)).toBeNull();
    expect(parseOrderStatusSnapshot({})).toBeNull();
    expect(parseOrderStatusSnapshot({ ...good, status: '' })).toBeNull();
    expect(parseOrderStatusSnapshot({ ...good, checkedAt: 'yesterday' })).toBeNull();
    // A captive portal's HTML page, parsed as JSON by mistake.
    expect(parseOrderStatusSnapshot('<!doctype html>')).toBeNull();
  });

  it('defaults only the fields that cannot be wrong', () => {
    const parsed = parseOrderStatusSnapshot({ status: 'ready', checkedAt: good.checkedAt });
    expect(parsed).toMatchObject({
      status: 'ready',
      awaitingConfirmation: false,
      paymentStatus: 'pending',
    });
  });
});

describe('how fresh the answer is, in words', () => {
  const now = Date.parse('2026-10-26T10:00:00.000Z');

  it('rounds down to something a person would say', () => {
    expect(checkedAgo('2026-10-26T09:59:55.000Z', now)).toBe('just now');
    expect(checkedAgo('2026-10-26T09:59:30.000Z', now)).toBe('30 seconds ago');
    expect(checkedAgo('2026-10-26T09:59:00.000Z', now)).toBe('a minute ago');
    expect(checkedAgo('2026-10-26T09:52:00.000Z', now)).toBe('8 minutes ago');
    expect(checkedAgo('2026-10-26T09:00:00.000Z', now)).toBe('an hour ago');
    expect(checkedAgo('2026-10-26T08:00:00.000Z', now)).toBe('2 hours ago');
  });

  it('never says "in the future" for a phone whose clock runs slow', () => {
    expect(checkedAgo('2026-10-26T10:00:30.000Z', now)).toBe('just now');
  });
});
