/**
 * Supabase environment.
 *
 * Deliberately tolerant: every value may be empty. The app must build, deploy
 * and render with NO environment variables at all, because the Netlify site
 * went live before the database existed. Callers check isSupabaseConfigured
 * and fall back to the demo data in lib/demo-data.ts.
 *
 * That fallback is a pilot convenience, not a design goal. Once the database
 * is live the fallback should be deleted so a misconfiguration fails loudly
 * instead of quietly serving sample data to a real guest.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** True when the browser-safe Supabase values are present. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * True when the service-role key is present.
 * Never expose this to the browser: it bypasses Row Level Security entirely.
 */
export const isSupabaseAdminConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
