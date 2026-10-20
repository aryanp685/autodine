import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ItemSheet } from '@/components/screens/CustomerMenu';
import { CartScope } from '@/components/CartProvider';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { DEFAULT_SLUG, getMenuScreenData } from '@/lib/db/menu-screen';
import { items as demoItems } from '@/lib/demo-data';
import { getSingleSearchParam } from '@/lib/query-params';
import { getCookieTableSession } from '@/lib/db/table-verification';

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
    searchParams: Promise<{ s?: string | string[]; item?: string | string[] }>;
  }) {
  const { s: rawSlug, item: rawItem } = await searchParams;
  const slug = getSingleSearchParam(rawSlug);
  const selectedItem = getSingleSearchParam(rawItem);
  if (!slug.valid || !selectedItem.valid) notFound();
  const s = slug.value;
  const item = selectedItem.value;
  const data = await getMenuScreenData(s);
  if (isSupabaseConfigured && !data) notFound();
  if (item && !(data?.items ?? demoItems).some((candidate) => candidate.id === item)) notFound();

  const scope = data?.restaurant.slug ?? s?.trim() ?? DEFAULT_SLUG;
  const tableSession = isSupabaseConfigured ? await getCookieTableSession() : null;
  const orderingEnabled = !isSupabaseConfigured || Boolean(data && tableSession?.restaurantSlug === data.restaurant.slug);
  const cartKey = data
    ? `${tableSession?.restaurantId ?? data.restaurant.slug}:${orderingEnabled ? tableSession?.tableId : 'unverified'}`
    : scope;
  return (
    <CartScope scope={scope} cartKey={cartKey}>
      <ItemSheet
        key={`${scope}:${cartKey}:${item ?? ''}`}
        data={data ? { ...data, itemId: item } : undefined}
        itemId={item}
        orderingEnabled={orderingEnabled}
      />
    </CartScope>
  );
}
