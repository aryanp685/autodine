/**
 * Password rules, in one place.
 *
 * Signup and password reset both set a password, and until now the rule lived
 * only in the signup action: reset would have accepted a four-character
 * password and quietly weakened an account that signup refused to weaken.
 *
 * The messages are written to be shown to a person, verbatim.
 */

/**
 * The permission to set a new password without knowing the old one.
 *
 * Written by /auth/confirm when it completes a recovery link, read by the
 * reset form and the action that saves it, and deleted as soon as the password
 * is saved. Fifteen minutes, because that is longer than reading one email and
 * shorter than leaving a machine unattended.
 */
export const RECOVERY_COOKIE = 'ad_recovery';

/** Supabase's own minimum is 6; the product sets a higher bar than the floor. */
export const MIN_PASSWORD = 10;

/**
 * bcrypt hashes at most 72 BYTES and silently ignores the rest.
 *
 * Checked here so a long passphrase is rejected with an explanation instead of
 * being accepted and then truncated -- two different long passwords sharing
 * their first 72 bytes would open the same account, which nobody who typed the
 * full thing would expect.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * What is wrong with this password, or null when nothing is.
 *
 * Deliberately not a strength meter: a meter tells an owner their password is
 * "medium" and lets them proceed anyway. This only rejects what is actually
 * unusable.
 */
export function passwordProblem(password: string): string | null {
  if (password.length === 0) return 'Please choose a password.';

  // A password with a trailing space copied out of a note is a password
  // nobody can retype. Better to refuse it now than to lock them out later.
  if (password !== password.trim()) {
    return 'Remove the space at the start or end of the password.';
  }

  if (password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }

  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return `Password is too long. Keep it under ${MAX_PASSWORD_BYTES} bytes — roughly ${MAX_PASSWORD_BYTES} English characters, fewer if you use emoji.`;
  }

  return null;
}

/** Whether the second field matches the first. Confirmation is never optional. */
export function passwordsMatch(password: string, confirmation: string): boolean {
  return password === confirmation && password.length > 0;
}
