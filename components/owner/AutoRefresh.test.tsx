import { describe, expect, it } from 'vitest';

import { shouldSkipRefresh } from './AutoRefresh';

/**
 * The decision, not the timer.
 *
 * `AutoRefresh` itself is a client component whose only output is a
 * `router.refresh()` on an interval; what can actually be wrong is the rule
 * about WHEN it is allowed to fire. That rule is a pure function, so it is the
 * thing pinned here -- including the two cases that would otherwise be found in
 * production: a hidden tab still polling, and a refresh landing in the middle
 * of somebody typing.
 */
describe('shouldSkipRefresh', () => {
  it('refuses to run without a document (server rendering)', () => {
    expect(shouldSkipRefresh(null)).toBe(true);
  });

  it('does nothing while the tab is hidden', () => {
    expect(shouldSkipRefresh({ hidden: true })).toBe(true);
  });

  it('refreshes a visible tab that nobody is typing in', () => {
    expect(shouldSkipRefresh({ hidden: false, activeElement: null })).toBe(false);
    expect(shouldSkipRefresh({ hidden: false, activeElement: { tagName: 'BODY' } })).toBe(false);
    expect(shouldSkipRefresh({ hidden: false, activeElement: { tagName: 'BUTTON' } })).toBe(false);
  });

  it('never yanks a field out from under a half-typed value', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(shouldSkipRefresh({ hidden: false, activeElement: { tagName } })).toBe(true);
    }
    expect(
      shouldSkipRefresh({ hidden: false, activeElement: { tagName: 'DIV', isContentEditable: true } }),
    ).toBe(true);
  });
});
