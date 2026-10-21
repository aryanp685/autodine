/** Server-only Supabase client. Its secret key bypasses RLS; validate authorization before every operation. */

import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/database';
import { SUPABASE_SECRET_KEY, SUPABASE_URL, isSupabaseAdminConfigured } from './env';

let cached: SupabaseClient<Database> | null = null;

export function getSupabaseAdmin() {
  if (!isSupabaseAdminConfigured) return null;
  if (!cached) {
    cached = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
