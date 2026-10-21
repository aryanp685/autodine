import type { Metadata } from 'next';
import { CartProvider } from '@/components/CartProvider';
import { Cart } from '@/components/screens/CartScreen';
import { getCartScreenData } from '@/lib/db/cart-screen';

export const metadata: Metadata = { title: 'Your order · AutoDine' };

/**
 * ?s=<slug> names the restaurant.
 *
 * The cart is mounted here rather than at the root because it is keyed by
 * restaurant: one cart spanning two kitchens would put a dish from one on
 * another's bill.
 */
export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; error?: string }>;
}) {
  const { s, error } = await searchParams;
  const data = await getCartScreenData(s);

  return (
    <CartProvider slug={s}>
      {error && (
        <div className="pg__alert" role="alert">
          <strong>Could not place that order.</strong>
          <p>{error}</p>
        </div>
      )}
      <Cart
        slug={s}
        restaurantName={data?.restaurantName}
        // No restaurant resolved: show the empty state rather than a menu of
        // prices that came from nowhere.
        items={data?.items ?? []}
      />
    </CartProvider>
  );
}
