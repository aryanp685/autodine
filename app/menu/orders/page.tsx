import type { Metadata } from 'next';
import { CartProvider } from '@/components/CartProvider';
import { GuestOrdersScreen } from '@/components/screens/GuestOrdersScreen';
import { getGuestBranding } from '@/lib/db/branding';
import { getCartScreenData } from '@/lib/db/cart-screen';
import { loadTableAccess } from '@/lib/table-access';

export const metadata: Metadata = { title: 'Your order · AutoDine', robots: { index: false } };

/**
 * ?s=<slug> names the restaurant.
 *
 * WHY THIS PAGE IS NOT GATED ON A TABLE SESSION
 *
 * The menu, the cart and checkout all refuse to render without a live scan,
 * because each of them can place an order. This one only reads what the guest's
 * own browser already stored, and it links to the order page -- which is
 * guarded by the guest token, not by a session.
 *
 * Gating it would produce a specific, bad failure: a guest orders at table 4,
 * walks to the counter, the session expires, and the tab that says "your order"
 * turns into "scan the QR again" while their food is being cooked. The token
 * they hold is still a perfectly good credential; nothing here needs a table.
 */
export default async function GuestOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const { s } = await searchParams;

  // The venue's name comes from the same read the cart uses; branding comes
  // from its own narrow query. Neither can name a restaurant the guest has not
  // already reached by slug.
  const [access, branding, data] = await Promise.all([
    loadTableAccess(s),
    getGuestBranding(s),
    getCartScreenData(s),
  ]);

  return (
    <CartProvider slug={s}>
      <GuestOrdersScreen
        slug={s}
        restaurantName={data?.restaurantName}
        accent={branding.accent}
        /* Only a verified session names a table; a stale one names nothing
           rather than keeping a claim the QR gate would have dropped. */
        tableLabel={access.status === 'verified' ? access.tableLabel : null}
      />
    </CartProvider>
  );
}
