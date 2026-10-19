import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Checkout } from '@/components/screens/CheckoutScreen';
import { CartScope } from '@/components/CartProvider';
import { DEFAULT_SLUG } from '@/lib/db/menu-screen';
import { getSingleSearchParam } from '@/lib/query-params';

export const metadata: Metadata = { title: 'Checkout · AutoDine' };

export default async function CheckoutPage({
  searchParams,
}: {
    searchParams: Promise<{ s?: string | string[] }>;
  }) {
  const { s: rawSlug } = await searchParams;
  const slug = getSingleSearchParam(rawSlug);
  if (!slug.valid) notFound();
  const scope = slug.value?.trim() || DEFAULT_SLUG;
  return (
    <CartScope scope={scope}>
      <Checkout />
    </CartScope>
  );
}
