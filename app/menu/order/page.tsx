import type { Metadata } from 'next';
import { OrderPlacedScreen } from '@/components/screens/OrderPlacedScreen';
import { getOrderScreenData } from '@/lib/db/order-screen';

export const metadata: Metadata = { title: 'Order placed · AutoDine' };

/**
 * ?s=<slug>&code=<order code>
 *
 * Both are needed. The code on its own would let anyone who guesses one read a
 * stranger's bill.
 */
export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; code?: string }>;
}) {
  const { s, code } = await searchParams;
  const data = await getOrderScreenData(s, code);

  return <OrderPlacedScreen data={data} />;
}
