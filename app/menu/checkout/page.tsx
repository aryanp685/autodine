import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { Checkout } from '@/components/screens/CheckoutScreen';
import { CartScope } from '@/components/CartProvider';
import { DEFAULT_SLUG } from '@/lib/db/menu-screen';
import { getSingleSearchParam } from '@/lib/query-params';
import { getCookieTableSession } from '@/lib/db/table-verification';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Checkout · AutoDine' };

export default async function CheckoutPage({
  searchParams,
}: {
    searchParams: Promise<{ s?: string | string[]; status?: string | string[] }>;
  }) {
  const { s: rawSlug, status: rawStatus } = await searchParams;
  const slug = getSingleSearchParam(rawSlug);
  const parsedStatus = getSingleSearchParam(rawStatus);
  if (!slug.valid) notFound();
  const scope = slug.value?.trim() || DEFAULT_SLUG;
  const status = parsedStatus.valid ? parsedStatus.value : undefined;
  const tableSession = isSupabaseConfigured ? await getCookieTableSession() : null;
  if (isSupabaseConfigured && (!tableSession || tableSession.restaurantSlug !== scope)) {
    return (
      <main className="qr-verify">
        <section className="qr-verify__card">
          <h1>Verify your table first</h1>
          <p className="qr-verify__intro">Your table verification expired or is unavailable. Get the current code from restaurant staff and scan the table QR again.</p>
          <Link className="qr-verify__back" href={`/menu?s=${encodeURIComponent(scope)}`}>Return to menu</Link>
        </section>
      </main>
    );
  }

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    if (!admin || !tableSession) {
      return <main className="qr-verify"><section className="qr-verify__card"><h1>Checkout unavailable</h1><p className="qr-verify__intro">We could not revalidate this table session. Please ask restaurant staff for help.</p></section></main>;
    }
    const { data: canWrite, error } = await admin.rpc('restaurant_can_write', { p_restaurant_id: tableSession.restaurantId });
    if (error || !canWrite) {
      return (
        <main className="qr-verify">
          <section className="qr-verify__card">
            <h1>Ordering is temporarily unavailable</h1>
            <p className="qr-verify__intro">This restaurant is in read-only mode. Existing data is safe; please ask staff when ordering is available again.</p>
            <Link className="qr-verify__back" href={`/menu?s=${encodeURIComponent(scope)}`}>Return to menu</Link>
          </section>
        </main>
      );
    }
  }

  const cartKey = tableSession ? `${tableSession.restaurantId}:${tableSession.tableId}` : scope;
  return (
    <CartScope scope={scope} cartKey={cartKey}>
      <Checkout
        submitEnabled={Boolean(isSupabaseConfigured && tableSession)}
        requestId={randomUUID()}
        status={status ?? undefined}
      />
    </CartScope>
  );
}
