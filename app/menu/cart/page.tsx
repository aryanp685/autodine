import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Cart } from '@/components/screens/CartScreen';
import { CartScope } from '@/components/CartProvider';
import { DEFAULT_SLUG } from '@/lib/db/menu-screen';
import { getSingleSearchParam } from '@/lib/query-params';
import { getCookieTableSession } from '@/lib/db/table-verification';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Your order · AutoDine' };

export default async function CartPage({
  searchParams,
}: {
    searchParams: Promise<{ s?: string | string[] }>;
  }) {
  const { s: rawSlug } = await searchParams;
  const slug = getSingleSearchParam(rawSlug);
  if (!slug.valid) notFound();
  const scope = slug.value?.trim() || DEFAULT_SLUG;
  const tableSession = isSupabaseConfigured ? await getCookieTableSession() : null;
  if (isSupabaseConfigured && (!tableSession || tableSession.restaurantSlug !== scope)) {
    return (
      <main className="qr-verify">
        <section className="qr-verify__card">
          <h1>Start ordering from your table</h1>
          <p className="qr-verify__intro">Scan the table QR to open the menu and start a guest ordering session before checkout.</p>
          <Link className="qr-verify__back" href={`/menu?s=${encodeURIComponent(scope)}`}>Return to menu</Link>
        </section>
      </main>
    );
  }
  const cartKey = tableSession ? `${tableSession.restaurantId}:${tableSession.tableId}` : scope;
  return (
    <CartScope scope={scope} cartKey={cartKey}>
      <Cart orderingEnabled={Boolean(isSupabaseConfigured && tableSession)} />
    </CartScope>
  );
}
