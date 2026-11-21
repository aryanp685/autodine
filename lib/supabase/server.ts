/**
 * Server Supabase client. Runs in Server Components, Route Handlers and
 * Server Actions. Reads the session from cookies so RLS sees the signed-in
 * user.
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/db/database';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from './env';

type SupabaseServerClientOptions = {
  /**
   * Keep the just-created PKCE verifier cookies when a resend Auth call fails.
   * The public resend endpoint must return the same account-neutral result for
   * sent, throttled, and provider-error outcomes; suppressing only these cookie
   * deletions avoids an HttpOnly-cookie presence side channel. The SDK's
   * bounded PKCE flow ring evicts old slots on later flow starts.
   */
  preservePkceVerifierCookiesOnAuthError?: boolean;
};

const PKCE_VERIFIER_COOKIE = /-(?:flow-[A-Za-z0-9_-]{8,64}-code-verifier|flows-code-verifier|code-verifier)$/;

export async function createSupabaseServerClient(
  clientOptions: SupabaseServerClientOptions = {},
) {
  if (!isSupabaseConfigured) return null;

  // Next 15: cookies() is async.
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      experimental: { appendPkceFlowIdToRedirects: true },
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            const isPkceDeletion = value === '' && options?.maxAge === 0 && PKCE_VERIFIER_COOKIE.test(name);
            if (clientOptions.preservePkceVerifierCookiesOnAuthError && isPkceDeletion) continue;
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
