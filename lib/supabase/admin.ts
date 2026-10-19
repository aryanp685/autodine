/**
 * ADMIN CLIENT — SERVER ONLY.
 *
 * This uses the service role key, which BYPASSES ROW LEVEL SECURITY. It can
 * read and write every restaurant's data. If this file, or the key it reads,
 * ever reaches the browser, tenant isolation is gone.
 *
 * Rules:
 *   - Never import this from a file marked 'use client'.
 *   - Never return this client, or anything derived from it, to the client.
 *   - Use it only for work that cannot be expressed as an RLS policy:
 *     webhooks that arrive without a session, background jobs, migrations.
 */

import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, isSupabaseAdminConfigured } from './env';

let cached: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (!isSupabaseAdminConfigured) return null;
  if (!cached) {
    cached = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
