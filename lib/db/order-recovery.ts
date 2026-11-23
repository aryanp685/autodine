import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/database';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isOrderToken } from '@/lib/db/order-status';

export type RecoverAttemptClient = Pick<SupabaseClient<Database>, 'rpc'>;

export type RecoverGuestOrderResult =
  | {
      kind: 'found';
      orderId: string;
      code: string;
      placedAt: string;
      prepStatus: string;
      awaitingConfirmation: boolean;
      tableLabel: string | null;
    }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; message: string };

export async function recoverGuestOrderAttempt(
  input: { slug?: string | null; attemptToken?: string | null },
  client?: RecoverAttemptClient | null,
): Promise<RecoverGuestOrderResult> {
  const slug = input.slug?.trim() ?? '';
  const attemptToken = input.attemptToken?.trim() ?? '';

  if (!slug || !isOrderToken(attemptToken)) {
    return { kind: 'not_found' };
  }

  if (!client && !isSupabaseConfigured) {
    return { kind: 'unavailable', message: 'No database is connected.' };
  }

  const supabase = client ?? (await createSupabaseServerClient());
  if (!supabase) {
    return { kind: 'unavailable', message: 'No database is connected.' };
  }

  const { data, error } = await supabase.rpc('recover_public_order_by_attempt', {
    p_slug: slug,
    p_guest_token: attemptToken,
  });

  if (error) {
    return { kind: 'unavailable', message: error.message };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { kind: 'not_found' };
  }

  const row = data as Record<string, unknown>;
  if (row.found !== true) {
    return { kind: 'not_found' };
  }

  const orderId = typeof row.order_id === 'string' ? row.order_id : '';
  const code = typeof row.code === 'string' ? row.code : '';
  if (!orderId || !code) {
    return { kind: 'not_found' };
  }

  return {
    kind: 'found',
    orderId,
    code,
    placedAt: typeof row.placed_at === 'string' ? row.placed_at : '',
    prepStatus: typeof row.prep_status === 'string' ? row.prep_status : 'new',
    awaitingConfirmation: row.awaiting_confirmation === true,
    tableLabel: typeof row.table_label === 'string' ? row.table_label : null,
  };
}
