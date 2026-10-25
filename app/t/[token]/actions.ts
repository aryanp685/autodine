'use server';

import { ipHash } from '@/lib/ip-hash';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { qrProblemReasonForStatus } from '@/lib/qr-problem';
import { isQrToken, saveTableSession, type TableSession } from '@/lib/table-session';
import { safeNextPath } from '@/lib/verify-next';

/**
 * Redeem a table code: the card's public token plus the six digits showing
 * inside the restaurant, for one hour at that table.
 *
 * WHY A SERVER ACTION AND NOT THE OLD ROUTE HANDLER
 *
 * The old /t/<token> route handler minted a session on GET. That made the scan
 * itself the proof, and it made the whole flow invisible: a link fetched by
 * anything -- a preview bot, a chat app unfurling the URL -- exchanged a
 * token. Now the exchange is a POST that carries a code a person had to read
 * off a screen, and it cannot happen as a side effect of opening a URL.
 *
 * THE COOKIE IS WRITTEN HERE, NOT IN THE PAGE
 *
 * Only Route Handlers and Server Actions may write cookies. This is the only
 * place a guest's session is created, so there is exactly one write to
 * reason about.
 *
 * FAILURES ARE STATUS WORDS, NOT MESSAGES
 *
 * verify_table_qr_with_code returns a status rather than raising, because a
 * raise would roll back the rate-limit attempt it had just recorded. The
 * mapping from those words to the sentences a guest reads lives in
 * lib/qr-problem.ts. Nothing the database says is ever rendered, and nothing
 * it says ever reaches a URL.
 */

function problemReason(reason: string): never {
  redirect(`/t/problem?r=${reason}`);
}

export async function verifyTableCodeAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '').trim();

  /**
   * Where this guest was going before we asked them for a code -- from the
   * checkout, usually. Not a URL: safeNextPath only returns a path this app
   * knows, so a crafted `next` cannot turn the form into an open redirect.
   */
  const next = safeNextPath(formData.get('next')?.toString(), null);
  const codeHref = (query: string) =>
    `/t/${encodeURIComponent(token)}/code?${query}&next=${encodeURIComponent(next)}`;

  // Shape check before anything else: this value goes into a URL on every
  // failure path, so it must never be arbitrary text.
  if (!isQrToken(token)) problemReason('unreadable');

  // Digits only, so a phone keyboard that inserts a space still works, and a
  // pasted "123 456" is not rejected as malformed.
  const code = String(formData.get('code') ?? '')
    .replace(/[^0-9]/g, '')
    .slice(0, 6);

  if (code.length !== 6) redirect(codeHref('e=wrong'));

  if (!isSupabaseConfigured) problemReason('offline');

  const supabase = await createSupabaseServerClient();
  if (!supabase) problemReason('offline');

  const { data, error } = await supabase.rpc('verify_table_qr_with_code', {
    p_public_token: token,
    p_code: code,
    p_ip_hash: await ipHash(token),
  });

  if (error) {
    // The function returns guest-caused failures as statuses, so an error
    // here is ours: a constraint, a permission problem, a database that is
    // not answering. Its message is not for a guest.
    console.error('[verify_table_qr_with_code] unexpected failure', error);
    problemReason('failed');
  }

  const row = Array.isArray(data) ? data[0] : undefined;
  if (!row) problemReason('failed');

  if (row.status === 'wrong') {
    // A mistyped digit is fixed by typing it again, so the guest goes back to
    // the form rather than to a page telling them to find a member of staff.
    redirect(codeHref(`e=${row.code_rotated ? 'rotated' : 'wrong'}`));
  }

  if (row.status === 'limited') {
    redirect(codeHref('e=limited'));
  }

  if (row.status !== 'ok') {
    problemReason(qrProblemReasonForStatus(row.status));
  }

  if (!row.session_token || !row.restaurant_slug || !row.table_label || !row.expires_at) {
    console.error('[verify_table_qr_with_code] ok without a session', row);
    problemReason('failed');
  }

  const session: TableSession = {
    token: row.session_token,
    slug: row.restaurant_slug,
    tableLabel: row.table_label,
    expiresAt: row.expires_at,
    // Kept so an expired session can send this guest straight back to this
    // card's code form rather than to a page that just says "scan again".
    qrToken: token,
  };

  await saveTableSession(session);

  /**
   * Back to where they were: the checkout, usually, with the cart untouched in
   * localStorage. `next` was narrowed to a known path at the top of this
   * function, and the slug comes from the database's answer rather than from
   * the form, so the destination cannot name a restaurant they are not in.
   */
  redirect(safeNextPath(next, row.restaurant_slug));
}
