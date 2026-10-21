import type { Metadata } from 'next';
import { CartProvider } from '@/components/CartProvider';
import { Checkout } from '@/components/screens/CheckoutScreen';
import { getCartScreenData } from '@/lib/db/cart-screen';

export const metadata: Metadata = { title: 'Checkout · AutoDine' };

/** ?s=<slug> names the restaurant. See the note on the cart page. */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const { s } = await searchParams;
  const data = await getCartScreenData(s);

  return (
    <CartProvider slug={s}>
      <Checkout slug={s} restaurantName={data?.restaurantName} items={data?.items ?? []} />
    </CartProvider>
  );
}
