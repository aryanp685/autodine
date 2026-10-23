import { describe, expect, it } from 'vitest';
import {
  READ_ONLY_SENTENCE,
  accessSummary,
  planSentence,
  type RestaurantAccess,
} from './access';

/**
 * What the dashboard says about the plan.
 *
 * This module exists because the same sentence was printed whatever plan the
 * restaurant was on: "Every feature in the product is on during the trial" for
 * a workspace whose trial had ended weeks ago and which was on a paid tier.
 * False copy about billing is the kind of bug that survives a demo and then
 * gets read out to a customer.
 */

function access(over: Partial<RestaurantAccess> = {}): RestaurantAccess {
  return {
    plan: 'trial',
    status: 'trialing',
    trialEndsAt: '2026-11-01T00:00:00.000Z',
    daysRemaining: 4,
    canWrite: true,
    readOnly: false,
    features: [],
    ...over,
  };
}

describe('planSentence', () => {
  it('mentions the trial only when there is a trial', () => {
    expect(planSentence(access())).toContain('trial');
  });

  it('never calls a paid plan a trial', () => {
    for (const plan of ['starter', 'professional', 'business']) {
      const sentence = planSentence(access({ plan, status: 'active' }));
      expect(sentence, plan).not.toMatch(/trial/i);
      expect(sentence, plan).toMatch(/plan/i);
    }
  });

  it('says what still works when the workspace is read-only', () => {
    const sentence = planSentence(
      access({ plan: 'professional', status: 'expired', readOnly: true, canWrite: false }),
    );
    expect(sentence).toBe(READ_ONLY_SENTENCE);
    // The point of the sentence: nobody should go looking for a backup.
    expect(sentence).toMatch(/nothing has been deleted/i);
    expect(sentence).not.toMatch(/trial/i);
  });

  it('does not claim a payment has been taken', () => {
    // Whether money was collected is the gateway's answer, not this page's.
    const sentence = planSentence(access({ plan: 'starter', status: 'active' }));
    expect(sentence).not.toMatch(/paid|payment received|charged/i);
  });
});

describe('accessSummary', () => {
  it('counts the days left, and only for a trial', () => {
    expect(accessSummary(access())).toBe('Free trial · 4 days left');
    expect(accessSummary(access({ daysRemaining: 1 }))).toBe('Free trial · 1 day left');
    expect(accessSummary(access({ plan: 'business', status: 'active' }))).not.toMatch(/trial/i);
  });

  it('says a read-only workspace is read-only, whatever the plan', () => {
    expect(accessSummary(access({ readOnly: true }))).toBe('Trial ended · read-only');
    expect(accessSummary(access({ plan: 'starter', readOnly: true }))).toBe(
      'Starter · read-only',
    );
  });
});
