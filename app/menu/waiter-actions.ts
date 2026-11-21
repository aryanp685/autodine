'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readTableSession } from '@/lib/table-session';

export type CallWaiterResult =
  | { ok: true; state: 'created' | 'already_open' | 'already_handled' }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ask for staff at the table named by the server-validated session cookie.
 * The browser supplies only an idempotency key; the database resolves the
 * restaurant/table from the bearer token and makes double taps harmless.
 */
export async function callWaiterAction(requestKey: string): Promise<CallWaiterResult> {
  if (!UUID.test(requestKey)) {
    return { ok: false, error: 'We could not send that request. Please try again.' };
  }

  try {
    const session = await readTableSession();
    if (!session) {
      return { ok: false, error: 'Verify your table before calling a waiter.' };
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return { ok: false, error: 'The restaurant could not be reached. Please tell a staff member.' };
    }

    const { data, error } = await supabase.rpc('call_waiter', {
      p_session_token: session.token,
      p_request_key: requestKey,
    });

    if (error) {
      if (error.code === 'P0001') return { ok: false, error: error.message };
      console.error('[callWaiterAction] request failed', { code: error.code });
      return { ok: false, error: 'We could not reach the restaurant. Please tell a staff member.' };
    }

    if (data === 'wait_a_moment') {
      return { ok: false, error: 'Please wait a little before calling again.' };
    }
    if (data === 'created' || data === 'already_open' || data === 'already_handled') {
      revalidatePath('/kitchen');
      return { ok: true, state: data };
    }

    return { ok: false, error: 'We could not confirm the request. Please tell a staff member.' };
  } catch {
    console.error('[callWaiterAction] unexpected request failure');
    return { ok: false, error: 'We could not reach the restaurant. Please tell a staff member.' };
  }
}
