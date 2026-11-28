import { createHash } from 'node:crypto';

/**
 * How many sign-in attempts a caller and an account may have in a window.
 *
 * Two keys are bumped for every attempt, because they stop different attacks:
 *
 *   address — one machine trying many accounts (password spraying). 20 in 15
 *             minutes leaves room for a restaurant whose whole team shares one
 *             office or mobile-carrier address.
 *   account — one account tried many times from wherever (brute force). 10 in
 *             15 minutes is far more than a person mistyping a password needs.
 *
 * The limiter is a brake, not a fence: an attacker with a pool of addresses can
 * still spread attempts out, and Supabase Auth applies its own per-account
 * limits underneath. What this removes is the cheap version — a script looping
 * sign-in from one place.
 */
export const SIGN_IN_BUDGETS = [
  { subject: 'address', limit: 20, windowSeconds: 900 },
  { subject: 'account', limit: 10, windowSeconds: 900 },
] as const;

export type SignInAttemptBudgetResult =
  | { allowed: true }
  | { allowed: false; reason: 'limited'; retryAfterSeconds: number }
  | { allowed: false; reason: 'unavailable'; retryAfterSeconds: null };

/** One atomic bump of a counter key. Null means the store could not answer. */
export type HitRateLimit = (
  key: string,
  limit: number,
  windowSeconds: number,
) => Promise<{ allowed: boolean; retryAfterSeconds: number } | null>;

/**
 * The address fingerprint arrives already salted and hashed (lib/ip-hash.ts);
 * the account is fingerprinted here so the rate-limit table never holds an
 * email address. Lower-casing matches the action's own normalisation.
 */
export function signInBudgetKeys(email: string, addressFingerprint: string): { address: string; account: string } {
  const account = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return {
    address: `auth:signin:addr:${addressFingerprint}`,
    account: `auth:signin:acct:${account}`,
  };
}

export async function consumeSignInAttemptBudget(
  email: string,
  addressFingerprint: string,
  hit: HitRateLimit,
): Promise<SignInAttemptBudgetResult> {
  const keys = signInBudgetKeys(email, addressFingerprint);
  let retryAfterSeconds = 0;

  for (const budget of SIGN_IN_BUDGETS) {
    const key = budget.subject === 'address' ? keys.address : keys.account;
    const outcome = await hit(key, budget.limit, budget.windowSeconds);
    if (!outcome) return { allowed: false, reason: 'unavailable', retryAfterSeconds: null };
    if (!outcome.allowed) retryAfterSeconds = Math.max(retryAfterSeconds, outcome.retryAfterSeconds);
  }

  return retryAfterSeconds > 0 ? { allowed: false, reason: 'limited', retryAfterSeconds } : { allowed: true };
}

/** A sentence that says the same thing whatever account was typed. */
export function signInLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many sign-in attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`;
}
