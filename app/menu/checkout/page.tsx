import type { Metadata } from 'next';
import { CartProvider } from '@/components/CartProvider';
import { Checkout } from '@/components/screens/CheckoutScreen';
import { TableGateScreen } from '@/components/screens/TableGateScreen';
import { VerifyToOrderScreen } from '@/components/screens/VerifyToOrderScreen';
import { getCartScreenData } from '@/lib/db/cart-screen';
import { onlinePaymentsConfigured } from '@/lib/payments/razorpay';
import { loadTableAccess, verifyAgainHref } from '@/lib/table-access';

export const metadata: Metadata = { title: 'Checkout · AutoDine' };

/**
 * ?s=<slug> names the restaurant. See the note on the cart page.
 *
 * WHERE THE CODE IS ACTUALLY ASKED FOR
 *
 * This is the step at which an order would be written, so this is the step
 * that needs the on-site code. A guest who scanned a live card but has not
 * entered the code sees their own bill and the six-digit form in one place --
 * `browse` below -- instead of a checkout with a "Place order" button that
 * could only fail. The cart is in localStorage, so the hop costs them nothing.
 *
 * The states after that are unchanged and still fail closed:
 *
 *   none         no card, no session. Scan the code on the table.
 *   stale        a card that is no longer live. Rescan.
 *   unavailable  the database could not be asked. Do not guess.
 *   verified     the database confirmed a live session -- render checkout.
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

  const data = await getCartScreenData(s);

  /**
   * A live card, no session: show the bill and ask for the code, on one screen.
   *
   * The card has already been resolved by public_qr_intro inside
   * loadTableAccess, so the restaurant, the table and the code window here are
   * the database's answer, not the cookie's.
   */
  if (access.status === 'browse') {
    return (
      <CartProvider slug={s}>
        <VerifyToOrderScreen
          slug={access.slug}
          token={access.qrToken}
          restaurantName={data?.restaurantName}
          tableLabel={access.tableLabel}
          windowMinutes={Math.max(1, Math.round(access.windowSeconds / 60))}
          items={data?.items ?? []}
          taxRateBps={data?.taxRateBps}
        />
      </CartProvider>
    );
  }

  return (
    <CartProvider slug={s}>
      <Checkout
        slug={s}
        restaurantName={data?.restaurantName}
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
