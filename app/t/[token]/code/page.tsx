import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TableVerifyScreen } from '@/components/screens/TableVerifyScreen';
import { isVerifyErrorReason, verifyErrorText } from '@/lib/qr-problem';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadTableAccess } from '@/lib/table-access';
import { safeNextPath } from '@/lib/verify-next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Enter the code · AutoDine',
  // A table's card URL names a seat in a restaurant; there is nothing here for
  // a search visitor.
  robots: { index: false, follow: false },
};

/**
 * The six-digit form: /t/<card token>/code.
 *
 * WHY IT IS NO LONGER AT /t/<token>
 *
 * That address is what the QR itself carries, and it now opens the menu. A
 * guest who has just sat down should be reading dishes, not typing digits --
 * the code is asked for at checkout, where it decides whether an order may be
 * written. This page is the place to enter it when the guest arrives another
 * way: an expired session, the "enter the code" button on a gate screen, or a
 * link a member of staff sends them.
 *
 * Already verified? Straight back to where they were going, because asking a
 * guest to type a code they have already proved is exactly the friction the
 * brief asked to remove.
 */
export default async function TableVerifyCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ e?: string; next?: string }>;
}) {
  const { token } = await params;
  const { e, next } = await searchParams;

  if (!isSupabaseConfigured) redirect('/t/problem?r=offline');

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect('/t/problem?r=offline');

  const { data, error } = await supabase.rpc('public_qr_intro', {
    p_public_token: token,
  });

  if (error) {
    console.error('[public_qr_intro] unexpected failure', error);
    redirect('/t/problem?r=failed');
  }

  const row = Array.isArray(data) ? data[0] : undefined;

  // No row means the token is not a live card for a table in service, and no
  // code will make it one.
  if (!row) redirect('/t/problem?r=unreadable');

  const destination = safeNextPath(next, row.restaurant_slug);

  // The database is asked, not the cookie: a cookie that merely looks
  // unexpired proves nothing. Already holding a live session means there is
  // nothing to type.
  const access = await loadTableAccess(row.restaurant_slug);
  if (access.status === 'verified') redirect(destination);

  return (
    <TableVerifyScreen
      token={token}
      restaurantName={row.restaurant_name}
      tableLabel={row.table_label}
      windowMinutes={Math.max(1, Math.round(row.window_seconds / 60))}
      // Only a path this file already knows survives; see lib/verify-next.ts.
      next={destination}
      {...(isVerifyErrorReason(e) ? { error: verifyErrorText(e) } : {})}
    />
  );
}
