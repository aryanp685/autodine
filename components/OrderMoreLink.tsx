'use client';

import Link from 'next/link';
import { useOptionalCart } from '@/components/CartProvider';

/** Keep the placed-order CTA inert until its just-used cart is cleared. */
export function OrderMoreLink({
  href,
  waitForEmptyCart = false,
}: {
  href: string;
  waitForEmptyCart?: boolean;
}) {
  const cart = useOptionalCart();
  const ready = !waitForEmptyCart || !cart || (cart.ready && cart.count === 0);
  const className = 'g-primary flex h-12 w-full items-center justify-center rounded-full text-[14px] font-semibold transition-transform duration-150 active:scale-[0.97]';

  if (!ready) {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        data-order-more-ready="false"
        className={`${className} cursor-wait opacity-65`}
      >
        Preparing your next order…
      </button>
    );
  }

  return (
    <Link href={href} data-order-more-ready="true" className={className}>
      Order something else
    </Link>
  );
}
