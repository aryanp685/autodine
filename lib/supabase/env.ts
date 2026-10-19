/**
 * Supabase environment.
 *
 * Accepts BOTH the current key format and the legacy one:
 *
 * | Purpose        | Current (use this)                      | Legacy (still works)           |
 * | -------------- | --------------------------------------- | ------------------------------ |
 * | Browser / RLS  | NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY     | NEXT_PUBLIC_SUPABASE_ANON_KEY  |
 * | Server / admin | SUPABASE_SECRET_KEY                      | SUPABASE_SERVICE_ROLE_KEY      |
 *
 * Why both: Supabase deprecated the legacy `anon` / `service_role` keys, to be
 * removed by the end of 2026. Projects created after November 2025 are issued
 * ONLY the new short `sb_publishable_...` / `sb_secret_...` keys. Reading the
 * legacy names alone would therefore leave a brand new project permanently
 * unconfigured -- and because this module tolerates empty values, it would not
 * error, it would quietly serve demo data forever. Both names are read so the
 * app works whichever the project has.
 *
 * The keys are interchangeable in the client libraries: Supabase states the new
 * values can be used "without any additional changes".
 *
 * Deliberately tolerant of EMPTY values: the app must build, deploy and render
 * with NO environment variables at all, because the site went live before the
 * database existed. Callers check isSupabaseConfigured and fall back to the
 * demo data in lib/db/demo-menu.ts.
 *
 * That fallback is a pilot convenience, not a design goal. Once the database is
 * live the fallback should be deleted so a misconfiguration fails loudly
 * instead of quietly serving sample data to a real guest.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

/**
 * First non-empty value wins.
 *
 * Deliberately not `??`: an env var that is *set but empty* (a leftover
 * `KEY=` line in .env.local) is `''`, not `undefined`, so `??` would stop
 * there and never fall through to the other name -- leaving the app
 * half-configured with no error to explain why.
 */
function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value !== undefined && value.trim() !== '') ?? '';
}

const PUBLISHABLE_KEY = firstNonEmpty(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const SECRET_KEY = firstNonEmpty(
  process.env.SUPABASE_SECRET_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * A secret key must never reach the browser.
 *
 * Next.js inlines every NEXT_PUBLIC_* variable into the client bundle. One
 * copy-paste slip -- the secret key in NEXT_PUBLIC_SUPABASE_SECRET_KEY instead
 * of SUPABASE_SECRET_KEY -- would ship a full RLS bypass to every visitor.
 *
 * Supabase does reject secret keys carrying a browser User-Agent, but that is a
 * safety net, not a guarantee: curl sends no such header, and the header is
 * client-controlled anyway. So refuse to start.
 */
function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;

  // Legacy anon and service-role keys are both JWTs. Decode only the public
  // role claim so a legacy service_role key cannot slip through this guard.
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(atob(base64)).role === 'service_role';
  } catch {
    // A malformed value will fail Supabase authentication; do not mistake it
    // for a confirmed secret key here.
    return false;
  }
}

function assertNotSecretKey(key: string): string {
  if (isSecretKey(key)) {
    throw new Error(
      'Supabase: a secret/service_role key was supplied through a NEXT_PUBLIC_* variable. ' +
        'Secret keys bypass Row Level Security and must never be inlined into the browser bundle. ' +
        'Put it in SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY, with no NEXT_PUBLIC_ prefix.'
    );
  }
  return key;
}

/** Browser-safe. Queries made with this are filtered by Row Level Security. */
export const SUPABASE_PUBLISHABLE_KEY = assertNotSecretKey(PUBLISHABLE_KEY);

/**
 * SERVER ONLY. Bypasses Row Level Security -- can read and write every
 * restaurant's data. Never import this from a file marked 'use client'.
 */
export const SUPABASE_SECRET_KEY = SECRET_KEY;

/** True when the browser-safe Supabase values are present. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

/** True when the secret key is present. */
export const isSupabaseAdminConfigured = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);
