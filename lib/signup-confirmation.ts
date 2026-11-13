import { safeLocalPath } from '@/lib/safe-next-path';

/** Short-lived, host-only aid for showing the address just entered on the pending screen. */
export const PENDING_SIGNUP_EMAIL_COOKIE = 'ad_pending_signup_email';
export const PENDING_SIGNUP_EMAIL_TTL_SECONDS = 60 * 60;
export const SIGNUP_CONFIRMATION_PENDING_PATH = '/signup/confirmation-pending';

export type SignupResendState = {
  status: 'idle' | 'invalid' | 'requested';
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize the address used by Auth without accepting unbounded form input. */
export function normalizeAuthEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 320 && EMAIL.test(email) ? email : null;
}

/**
 * Build the owner-confirmation callback from the trusted request-origin helper.
 * The route and destination are fixed here; the dashboard path still passes
 * through the shared same-origin redirect validator.
 */
export function signupConfirmationRedirectTo(origin: string | null | undefined): string | null {
  if (!origin) return null;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }

  const next = safeLocalPath('/dashboard', '/dashboard');
  const callback = new URL('/auth/confirm', parsed.origin);
  callback.searchParams.set('flow', 'signup');
  callback.searchParams.set('next', next);
  return callback.toString();
}
