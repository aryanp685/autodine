import { describe, expect, it } from 'vitest';
import {
  PREP_TRANSITIONS,
  canAdvance,
  nextPrepState,
} from './prep';

describe('prep state machine', () => {
  it('walks a ticket from new through to served', () => {
    expect(nextPrepState('new')).toBe('preparing');
    expect(nextPrepState('preparing')).toBe('ready');
    expect(nextPrepState('ready')).toBe('served');
  });

  it('treats served as terminal', () => {
    // A cook double-tapping a served ticket is normal. It must be a no-op,
    // not an error, or the board litters itself with false failures.
    expect(nextPrepState('served')).toBeNull();
    expect(canAdvance('served')).toBe(false);
  });

  it('treats cancelled as terminal', () => {
    expect(nextPrepState('cancelled')).toBeNull();
  });

  it('has no reverse transition out of any state', () => {
    // The regression this guards: if 'served' -> 'ready' is ever added, a
    // mis-tap becomes a way to make a ticket silently reappear on the board.
    for (const [from, to] of Object.entries(PREP_TRANSITIONS)) {
      if (!to) continue;
      const order = ['new', 'preparing', 'ready', 'served'];
      expect(order.indexOf(to)).toBeGreaterThan(order.indexOf(from));
    }
  });

  it('covers every declared prep status exactly once', () => {
    // A new status added to types.ts without a transition here would fall
    // through to null and look terminal by accident.
    expect(Object.keys(PREP_TRANSITIONS).sort()).toEqual([
      'cancelled',
      'new',
      'preparing',
      'ready',
      'served',
    ]);
  });

  it('returns null for junk rather than throwing', () => {
    expect(nextPrepState('wat')).toBeNull();
    expect(nextPrepState(null)).toBeNull();
    expect(nextPrepState(undefined)).toBeNull();
  });
});
