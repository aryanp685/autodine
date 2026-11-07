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
 * legacy names alone would therefore leave a brand new project unconfigured.
 * Both names are read so the app works whichever format the project has; the
 * runtime guard below prevents missing configuration from silently becoming
 * demo data.
 *
 * The keys are interchangeable in the client libraries: Supabase states the new
 * values can be used "without any additional changes".
 *
 * Empty values are accepted only for tests, the explicit local-development
 * demo mode, and the explicitly opted-in hermetic CI build. A production
 * build without the public Supabase URL/key fails; it must never quietly serve
 * fictional restaurant data to a guest.
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

/**
 * Demo fallback is a local/test convenience, never a production fallback.
 *
 * GitHub's hermetic browser workflow intentionally builds without Supabase to
 * test presentation. It must opt into that exception explicitly; a Vercel or
 * other production build with missing public Supabase configuration fails at
 * build/import time instead of serving fictional restaurant data.
 */
const allowHermeticDemoBuild =
  process.env.GITHUB_ACTIONS === 'true' &&
  process.env.CI === 'true' &&
  process.env.AUTODINE_TEST_DEMO_BUILD === 'true' &&
  process.env.VERCEL_ENV === 'test';
const allowExplicitLocalDemo =
  process.env.NODE_ENV === 'development' && process.env.AUTODINE_DEMO_MODE === 'true';

/** Local-only demo state; it never becomes true in a production build. */
export const isDemoMode = !isSupabaseConfigured && allowExplicitLocalDemo;

if (
  !isSupabaseConfigured &&
  ((process.env.NODE_ENV === 'production' && !allowHermeticDemoBuild) ||
    (process.env.NODE_ENV === 'development' && !allowExplicitLocalDemo))
) {
  throw new Error(
    'AutoDine requires NEXT_PUBLIC_SUPABASE_URL and a public Supabase key. ' +
      'Demo data is never an automatic fallback: configure Supabase, or set AUTODINE_DEMO_MODE=true for local development only.'
  );
}
