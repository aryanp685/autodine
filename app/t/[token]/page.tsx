import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TableVerifyScreen } from '@/components/screens/TableVerifyScreen';
import { isVerifyErrorReason, verifyErrorText } from '@/lib/qr-problem';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadTableAccess } from '@/lib/table-access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify your table · AutoDine',
  // A table's card URL is not something to be indexed: it names a seat in a
  // restaurant, and there is nothing on the other side for a search visitor.
  robots: { index: false, follow: false },
};

/**
 * What a printed QR code points at: /t/<public token>.
 *
 * This page used to be a route handler that exchanged the token for a session
 * on sight. Anyone holding a photograph of a card got the table. Now the card
 * only names the table; the session is minted by the form on this page, once
 * the guest has typed the code showing inside the restaurant.
 *
 * WHY THE PAGE FETCHES THE RESTAURANT NAME
 *
 * A guest who scans a card should see the place they are standing in, not a
 * form asking for a code with no context. public_qr_intro() returns the
 * restaurant and the table, and -- importantly -- returns nothing at all for a
 * card that is not live, so the page can send them to the explanation instead
 * of asking them to type a code for a table that no longer exists.
 *
 * It creates nothing and proves nothing.
 */
export default async function TableVerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { token } = await params;
  const { e } = await searchParams;

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
  // code will make it one. /t/problem says so instead of asking for a code
  // that cannot work.
  if (!row) redirect('/t/problem?r=unreadable');

  // Already verified here? The database is asked, not the cookie -- a cookie
  // that merely looks unexpired proves nothing. This keeps "back" and a
  // re-scan from making a guest type a second code for a table they already
  // hold.
  const access = await loadTableAccess(row.restaurant_slug);
  if (access.status === 'verified') {
    redirect(`/menu?s=${encodeURIComponent(row.restaurant_slug)}`);
  }

  return (
    <TableVerifyScreen
      token={token}
      restaurantName={row.restaurant_name}
      tableLabel={row.table_label}
      windowMinutes={Math.max(1, Math.round(row.window_seconds / 60))}
      {...(isVerifyErrorReason(e) ? { error: verifyErrorText(e) } : {})}
    />
  );
}
