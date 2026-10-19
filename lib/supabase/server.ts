/**
 * Server Supabase client. Runs in Server Components, Route Handlers and
 * Server Actions. Reads the session from cookies so RLS sees the signed-in
 * user.
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/db/database';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from './env';

export async function createSupabaseServerClient() {
  if (!isSupabaseConfigured) return null;

  // Next 15: cookies() is async.
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Route Handlers and Server
          // Actions can, and this same client is used there. Swallowing the
          // error is the documented pattern from Supabase, not an oversight.
        }
      },
    },
  });
}
