import type { Metadata } from 'next';
import { CartProvider } from '@/components/CartProvider';
import { Cart } from '@/components/screens/CartScreen';
import { TableGateScreen } from '@/components/screens/TableGateScreen';
import { getCartScreenData } from '@/lib/db/cart-screen';
import { getGuestBranding } from '@/lib/db/branding';
import { loadTableAccess, verifyAgainHref } from '@/lib/table-access';

export const metadata: Metadata = { title: 'Your order · AutoDine' };

/**
 * ?s=<slug> names the restaurant.
 *
 * The cart is mounted here rather than at the root because it is keyed by
 * restaurant: one cart spanning two kitchens would put a dish from one on
 * another's bill.
 *
 * GATED LIKE /menu
 *
 * The cart holds the things a guest is about to order, and the button on it
 * posts to the checkout action. An open cart page was therefore a working step
 * of the ordering flow for somebody who never scanned anything. The database
 * refuses a sessionless order, and the action refuses one too -- but a page
 * that renders a "Place order" button and then fails is worse than a page that
 * says where to scan.
 */
export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; error?: string }>;
}) {
  const { s, error } = await searchParams;

  const access = await loadTableAccess(s);

  if (access.status === 'none') return <TableGateScreen reason="none" />;
  if (access.status === 'unavailable') return <TableGateScreen reason="unavailable" />;
  if (access.status === 'stale') {
    return <TableGateScreen reason="stale" verifyHref={verifyAgainHref(access)} />;
  }

  // Branding is fetched separately from the cart: the cart needs only the
  // restaurant's name and rate, while the accent paints the whole flow.
  const [data, branding] = await Promise.all([getCartScreenData(s), getGuestBranding(s)]);

  return (
    <CartProvider slug={s}>
      {/* The action redirects back here with ?error=…, so this is where the
          guest learns why. It sits above the cart rather than floating at the
          edge of the page: it is about the order they are looking at. */}
      {error && (
        <div className="cart__alertWrap">
          <div className="pg__alert" role="alert">
            <strong>Could not place that order.</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      <Cart
        slug={s}
        restaurantName={data?.restaurantName}
        accent={branding.accent}
        // Only a verified session names a table. Demo mode can carry one from
        // the sample cookie; a real database read decides it above.
        tableLabel={access.status === 'verified' ? access.tableLabel : null}
        taxRateBps={data?.taxRateBps}
        // No restaurant resolved: show the empty state rather than a menu of
        // prices that came from nowhere.
        items={data?.items ?? []}
      />
    </CartProvider>
  );
}
