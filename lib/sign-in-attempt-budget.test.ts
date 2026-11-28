import { describe, expect, it, vi } from 'vitest';

import {
  SIGN_IN_BUDGETS,
  consumeSignInAttemptBudget,
  signInBudgetKeys,
  signInLimitedMessage,
  type HitRateLimit,
} from './sign-in-attempt-budget';

const ADDRESS = 'addr-fingerprint-abc';

function recordingHit(result: { allowed: boolean; retryAfterSeconds: number } | null = { allowed: true, retryAfterSeconds: 0 }) {
  const calls: { key: string; limit: number; windowSeconds: number }[] = [];
  const hit: HitRateLimit = async (key, limit, windowSeconds) => {
    calls.push({ key, limit, windowSeconds });
    return result;
  };
  return { hit, calls };
}

describe('sign-in attempt budget', () => {
  it('bumps one counter per caller and one per account, each with its own allowance', async () => {
    const { hit, calls } = recordingHit();

    await expect(consumeSignInAttemptBudget('Owner@Example.test', ADDRESS, hit)).resolves.toEqual({ allowed: true });

    expect(calls).toEqual(
      SIGN_IN_BUDGETS.map((budget) => ({
        key: budget.subject === 'address' ? `auth:signin:addr:${ADDRESS}` : expect.stringMatching(/^auth:signin:acct:[0-9a-f]{64}$/),
        limit: budget.limit,
        windowSeconds: 900,
      })),
    );
  });

  it('never puts an email address in the rate-limit key', async () => {
    const { address, account } = signInBudgetKeys(' Owner@Example.test ', ADDRESS);

    expect(address).not.toContain('@');
    expect(account).not.toContain('@');
    expect(account).not.toContain('owner');
    expect(signInBudgetKeys('owner@example.test', ADDRESS)).toEqual({ address, account });
  });

  it('reports the longest wait when either counter is spent', async () => {
    let call = 0;
    const hit: HitRateLimit = async () => (++call === 1 ? { allowed: false, retryAfterSeconds: 120 } : { allowed: false, retryAfterSeconds: 640 });

    await expect(consumeSignInAttemptBudget('owner@example.test', ADDRESS, hit)).resolves.toEqual({
      allowed: false,
      reason: 'limited',
      retryAfterSeconds: 640,
    });
  });

  it('treats a store that cannot answer as unavailable rather than a refusal', async () => {
    const hit = vi.fn(async () => null);

    await expect(consumeSignInAttemptBudget('owner@example.test', ADDRESS, hit)).resolves.toEqual({
      allowed: false,
      reason: 'unavailable',
      retryAfterSeconds: null,
    });
  });

  it('states the wait in whole minutes, never the account', () => {
    expect(signInLimitedMessage(240)).toBe('Too many sign-in attempts. Please wait 4 minutes and try again.');
    expect(signInLimitedMessage(30)).toBe('Too many sign-in attempts. Please wait 1 minute and try again.');
    expect(signInLimitedMessage(240)).not.toContain('@');
  });
});
