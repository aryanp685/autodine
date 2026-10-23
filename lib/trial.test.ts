import { describe, expect, it } from 'vitest';
import { TRIAL_DAYS, computeTrialState, orderBlockedReason } from './trial';

const START = new Date('2026-10-19T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number, ms = 0) => new Date(START.getTime() + days * DAY + ms);

describe('trial basics', () => {
  it('is 7 days long', () => {
    expect(TRIAL_DAYS).toBe(7);
  });

  it('gives the full trial the moment an account is created', () => {
    const s = computeTrialState({ startedAt: START, now: START });
    expect(s.status).toBe('trialing');
    expect(s.daysRemaining).toBe(7);
    expect(s.canPlaceOrders).toBe(true);
    expect(s.readOnly).toBe(false);
  });

  it('ends exactly 7 days after it started', () => {
    const s = computeTrialState({ startedAt: START, now: START });
    expect(s.endsAt.toISOString()).toBe('2026-10-26T10:00:00.000Z');
  });

  it('counts down', () => {
    expect(computeTrialState({ startedAt: START, now: at(3) }).daysRemaining).toBe(4);
    expect(computeTrialState({ startedAt: START, now: at(6) }).daysRemaining).toBe(1);
  });
});

describe('expiry', () => {
  it('is still trialing one second before the end', () => {
    const s = computeTrialState({ startedAt: START, now: at(7, -1000) });
    expect(s.status).toBe('trialing');
    expect(s.canPlaceOrders).toBe(true);
  });

  it('expires exactly at the end, not a moment earlier or later', () => {
    const s = computeTrialState({ startedAt: START, now: at(10) });
    expect(s.status).toBe('expired');
    expect(s.expired).toBe(true);
    expect(s.daysRemaining).toBe(0);
  });

  it('blocks new orders once expired', () => {
    const s = computeTrialState({ startedAt: START, now: at(8) });
    expect(s.canPlaceOrders).toBe(false);
    expect(s.readOnly).toBe(true);
  });

  it('is read-only, not deleted — the state never says otherwise', () => {
    // "Read-only" must never imply data removal. There is intentionally no
    // deletion path in this module: nothing here can destroy an order.
    const s = computeTrialState({ startedAt: START, now: at(60) });
    expect(s.readOnly).toBe(true);
    expect(s.canPlaceOrders).toBe(false);
    expect(s.status).toBe('expired');
  });
});

describe('subscription', () => {
  it('reactivates an expired account', () => {
    const s = computeTrialState({ startedAt: START, now: at(30), subscribedAt: at(12) });
    expect(s.status).toBe('subscribed');
    expect(s.canPlaceOrders).toBe(true);
    expect(s.readOnly).toBe(false);
  });

  it('outranks the trial even while trialing', () => {
    const s = computeTrialState({ startedAt: START, now: at(2), subscribedAt: at(1) });
    expect(s.status).toBe('subscribed');
    expect(s.daysRemaining).toBe(0);
  });

  it('never expires once subscribed', () => {
    const s = computeTrialState({ startedAt: START, now: at(365), subscribedAt: at(1) });
    expect(s.expired).toBe(false);
    expect(s.canPlaceOrders).toBe(true);
  });
});

describe('clock skew', () => {
  it('does not expire someone whose clock reads before the start', () => {
    // A bad clock must not lock a paying restaurant out of service.
    const s = computeTrialState({ startedAt: START, now: at(-1) });
    expect(s.status).toBe('trialing');
    expect(s.daysRemaining).toBe(7);
    expect(s.canPlaceOrders).toBe(true);
  });
});

describe('orderBlockedReason', () => {
  it('is null while the account may take orders', () => {
    expect(orderBlockedReason(computeTrialState({ startedAt: START, now: at(1) }))).toBeNull();
    expect(orderBlockedReason(computeTrialState({ startedAt: START, now: at(1), subscribedAt: at(2) }))).toBeNull();
  });

  it('explains itself to a human at the counter when blocked', () => {
    const reason = orderBlockedReason(computeTrialState({ startedAt: START, now: at(9) }));
    expect(reason).not.toBeNull();
    // The message must reassure that nothing was lost: that is the promise.
    expect(reason).toContain('still here');
    expect(reason).toContain('choose a plan');
  });
});
