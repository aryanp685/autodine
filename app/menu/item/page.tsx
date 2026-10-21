import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CartProvider } from '@/components/CartProvider';
import { ItemSheet } from '@/components/screens/CustomerMenu';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getMenuScreenData } from '@/lib/db/menu-screen';

export const metadata: Metadata = { title: 'Customise · AutoDine' };

/**
 * ?s=<slug> picks the restaurant, ?item=<id> the dish to customise.
 *
 * Both are query parameters so the locked screens' existing links to
 * /menu/item keep working unchanged.
 */
export default async function ItemPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; item?: string }>;
}) {
  const { s, item } = await searchParams;
  const data = await getMenuScreenData(s);
  if (isSupabaseConfigured && !data) notFound();

  return (
    <CartProvider slug={s}>
      <ItemSheet data={data ? { ...data, itemId: item } : undefined} itemId={item} />
    </CartProvider>
  );
}
