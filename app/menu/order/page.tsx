import type { Metadata } from 'next';
import { OrderPlacedScreen } from '@/components/screens/OrderPlacedScreen';
import { getOrderScreenData } from '@/lib/db/order-screen';
import { onlinePaymentOffer, type OnlineOffer } from '@/lib/payments/online-availability';
import { onlinePaymentsConfigured } from '@/lib/payments/razorpay';

export const metadata: Metadata = { title: 'Order placed · AutoDine' };

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
  const data = await getOrderScreenData(s, code, t);

  /**
   * Two separate facts decide whether a pay button is drawn: the owner's
   * switch, read from the database with the order, and whether this DEPLOYMENT
   * has a gateway key. The second is an environment question -- asking it here
   * keeps the price of a missing key out of every screen that reads an order.
   */
  const onlinePay: OnlineOffer | null = data
    ? onlinePaymentOffer({
        enabled: data.onlineEnabled,
        configured: onlinePaymentsConfigured(),
        paymentStatus: data.paymentStatus,
        prepStatus: data.prepStatus,
        duePaise: data.totalPaise,
        hasToken: Boolean(t),
      })
    : null;

  return (
    <OrderPlacedScreen data={data} token={t} slug={s} onlinePay={onlinePay} />
  );
}
