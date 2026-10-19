/**
 * Browser Supabase client. Uses the anon key, so every query is filtered by
 * Row Level Security. That is the point: the browser can only ever see what
 * the policies allow, even if someone tampers with the client.
 */

'use client';

import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './env';

let cached: ReturnType<typeof createBrowserClient> | null = null;

/** Returns null when Supabase is not configured; callers must handle that. */
export function getSupabaseBrowser() {
  if (!isSupabaseConfigured) return null;
  if (!cached) cached = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}
