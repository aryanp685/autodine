import { describe, expect, it } from 'vitest';

import type { RestaurantAccess } from '@/lib/access';
import { subscriptionStatusOf } from './status';

function access(overrides: Partial<RestaurantAccess>): RestaurantAccess {
  return {
    plan: 'trial',
    status: 'trialing',
    canWrite: true,
    readOnly: false,
    daysRemaining: 10,
    trialEndsAt: null,
    features: [],
    ...overrides,
  } as RestaurantAccess;
}

describe('subscriptionStatusOf', () => {
  it('never walls an owner over a missing or failed billing read', () => {
    expect(subscriptionStatusOf(null)).toBe('ok');
    expect(subscriptionStatusOf(undefined)).toBe('ok');
  });

  it('lets a trial with days left through', () => {
    expect(subscriptionStatusOf(access({ daysRemaining: 10 }))).toBe('ok');
    expect(subscriptionStatusOf(access({ daysRemaining: 2 }))).toBe('ending');
  });

  it('blocks once the 21 days are over and no plan is bought', () => {
    expect(subscriptionStatusOf(access({ daysRemaining: 0 }))).toBe('blocked');
    expect(subscriptionStatusOf(access({ canWrite: false, readOnly: true, daysRemaining: 0 }))).toBe('blocked');
  });

  it('lets every paid plan through', () => {
    for (const plan of ['starter', 'professional', 'business'] as const) {
      expect(subscriptionStatusOf(access({ plan, status: 'active', daysRemaining: 0 }))).toBe('ok');
    }
  });
});
