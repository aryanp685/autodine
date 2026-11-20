import type { Metadata } from 'next';
import { CartProvider } from '@/components/CartProvider';
import { OrderPlacedScreen } from '@/components/screens/OrderPlacedScreen';
import { getOrderScreenData } from '@/lib/db/order-screen';
import { loadTableAccess } from '@/lib/table-access';

// Not "Order placed": this page also renders the state of a link that could
// not be opened, and a tab promising an order that is not there is a small lie.
export const metadata: Metadata = { title: 'Your order · AutoDine', robots: { index: false, follow: false }, referrer: 'no-referrer' };

// This page is keyed by a guest credential and contains a private bill plus
// the current kitchen state. Never cache it across order requests; a stale
// render would expose another guest's bill or misreport a ticket's status.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * ?s=<slug>&code=<order code>&t=<guest token>
 *
 * All three are needed, and the token is the one that matters: the code alone
 * is five characters read out at the counter, so a page that opened on a
 * guessed code would show a stranger's bill. The token is issued once, in the
 * redirect straight after ordering, and it is the guest's credential for
 * reading, changing and cancelling the order.
 *
 * A link without a token is not an error -- it is what an old bookmark or a
 * pasted code looks like -- so the screen says the order could not be opened
 * rather than pretending it does not exist.
 */
export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; code?: string; t?: string }>;
}) {
  const { s, code, t } = await searchParams;
  const [data, access] = await Promise.all([
    getOrderScreenData(s, code, t),
    loadTableAccess(s),
  ]);

  return (
    <CartProvider slug={s}>
      <OrderPlacedScreen
        data={data}
        token={t}
        slug={s}
        canCallWaiter={access.status === 'verified' && access.tableLabel === data?.tableLabel}
        brandState={data?.brandState}
      />
    </CartProvider>
  );
}
