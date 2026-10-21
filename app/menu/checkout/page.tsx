import type { Metadata } from 'next';
import { CartProvider } from '@/components/CartProvider';
import { Checkout } from '@/components/screens/CheckoutScreen';
import { getCartScreenData } from '@/lib/db/cart-screen';
import { onlinePaymentsConfigured } from '@/lib/payments/razorpay';

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
      <Checkout
        slug={s}
        restaurantName={data?.restaurantName}
        taxRateBps={data?.taxRateBps}
        items={data?.items ?? []}
        // Both are needed before the screen may promise card payment later:
        // the owner's switch, and a gateway this deployment can verify with.
        onlinePaymentAvailable={Boolean(data?.onlinePaymentsEnabled) && onlinePaymentsConfigured()}
      />
    </CartProvider>
  );
}
