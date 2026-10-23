import type { Metadata } from 'next';
import { CartProvider } from '@/components/CartProvider';
import { Checkout } from '@/components/screens/CheckoutScreen';
import { TableGateScreen } from '@/components/screens/TableGateScreen';
import { getCartScreenData } from '@/lib/db/cart-screen';
import { getGuestBranding } from '@/lib/db/branding';
import { onlinePaymentsConfigured } from '@/lib/payments/razorpay';
import { loadTableAccess, verifyAgainHref } from '@/lib/table-access';

export const metadata: Metadata = { title: 'Checkout · AutoDine' };

/**
 * ?s=<slug> names the restaurant. See the note on the cart page.
 *
 * GATED LIKE THE CART
 *
 * This page was the one step of the ordering flow that never asked for a
 * table. The action it posts to does refuse an unverified guest, so nothing
 * could actually be ordered from here -- but the page still rendered a
 * complete, working-looking checkout with a live "Place order" button, and
 * only failed after the tap. A guest who pasted a forwarded link got eleven
 * seconds of believing they were about to eat.
 *
 * An unverified guest is sent to the same gate the cart uses, which names the
 * fix (scan the card, type the code) instead of a form that will reject them.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const { s } = await searchParams;

  const access = await loadTableAccess(s);

  if (access.status === 'none') return <TableGateScreen reason="none" />;
  if (access.status === 'unavailable') return <TableGateScreen reason="unavailable" />;
  if (access.status === 'stale') {
    return <TableGateScreen reason="stale" verifyHref={verifyAgainHref(access)} />;
  }

  const [data, branding] = await Promise.all([getCartScreenData(s), getGuestBranding(s)]);

  return (
    <CartProvider slug={s}>
      <Checkout
        slug={s}
        restaurantName={data?.restaurantName}
        accent={branding.accent}
        tableLabel={access.status === 'verified' ? access.tableLabel : null}
        taxRateBps={data?.taxRateBps}
        items={data?.items ?? []}
        // Both are needed before the screen may promise card payment later:
        // the owner's switch, and a gateway this deployment can verify with.
        onlinePaymentAvailable={Boolean(data?.onlinePaymentsEnabled) && onlinePaymentsConfigured()}
      />
    </CartProvider>
  );
}
