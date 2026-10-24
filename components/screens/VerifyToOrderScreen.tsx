'use client';

import Link from 'next/link';
import { GuestFlow } from '@/components/GuestFlow';
import { WhereToFindCode } from '@/components/WhereToFindCode';
import { VerifyCodeForm } from '@/components/VerifyCodeForm';
import { useCart } from '@/components/CartProvider';
import { guestAccentStyle } from '@/lib/branding/palette';
import { priceCart, type MenuItemPrice } from '@/lib/cart-pricing';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';

/**
 * The one moment a guest is asked for the on-site code.
 *
 * WHY HERE AND NOT AT THE DOOR
 *
 * The code exists to stop a photograph of a table's card ordering from
 * somewhere else. It does that job perfectly well at the till end of the flow:
 * the order is the thing that must not be forged, and the order is what this
 * screen guards. Asking at the scan instead made every guest work before they
 * could read a menu, which is the friction the brief asked to remove.
 *
 * WHY THE BILL IS ON THIS SCREEN
 *
 * A guest who taps "Place order" and lands on a form with no total has no idea
 * whether their cart survived the hop -- and the cart lives in localStorage,
 * so it looks empty to anyone who panics and goes back. So the money is shown
 * here, exactly as it will be shown one step later, and the code form sits
 * under it saying what it is for.
 *
 * WHAT IT PROMISES
 *
 * Nothing. There is no "your order is placed" copy here, and there cannot be:
 * this screen has not called place_public_order and does not know whether the
 * code it is about to send is right. The success sentence belongs to the order
 * page, which renders only after the database returns a code.
 */
export function VerifyToOrderScreen({
  slug,
  token,
  restaurantName,
  tableLabel,
  windowMinutes,
  items,
  taxRateBps,
  cartCount,
  cartTotalPaise,
}: {
  slug: string;
  /** The card that was scanned, so the form needs no second scan. */
  token: string;
  restaurantName?: string;
  tableLabel: string;
  windowMinutes: number;
  items: MenuItemPrice[];
  taxRateBps?: number;
  /**
   * The cart as the browser holds it. Used only for the "your cart is safe"
   * line when the priced cart cannot be read on the server -- the bill itself
   * is always computed from the menu data and the cart lines.
   */
  cartCount?: number;
  cartTotalPaise?: number;
}) {
  const cart = useCart();
  const priced = priceCart(cart.lines, items, taxRateBps);
  const { totalPaise } = priced.totals;
  const qty = priced.lines.reduce((sum, line) => sum + line.qty, 0);

  // Before the stored cart is read, the server's count is the honest answer;
  // afterwards the priced one is, because it drops dishes that sold out.
  const showingQty = cart.ready ? qty : (cartCount ?? 0);
  const showingTotal = cart.ready ? totalPaise : (cartTotalPaise ?? 0);

  const next = `/menu/checkout?s=${encodeURIComponent(slug)}`;

  return (
    <GuestFlow
      style={guestAccentStyle()}
      step="pay"
      venue={restaurantName}
      table={tableLabel}
      back={{ href: `/menu/cart?s=${encodeURIComponent(slug)}`, label: 'Back to your order' }}
    >
      <header className="px-4 pt-6 pb-4">
        <p className="g-eyebrow">One step before the kitchen</p>
        <h1 className="g-display mt-1.5">Confirm your table</h1>
        <p className="g-lede mt-1.5">
          Table {tableLabel} is confirmed. To send this order to the kitchen, type the six-digit
          code showing inside {restaurantName ?? 'the restaurant'}. Nothing has been ordered yet.
        </p>
      </header>

      <div className="px-4 pb-8">
        <section aria-labelledby="vt-order" className="g-panel px-4 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="vt-order" className="g-eyebrow m-0">
              Your order
            </h2>
            {showingQty > 0 ? (
              <span className="tnum text-[12px] text-gink-46">
                {showingQty} {showingQty === 1 ? 'item' : 'items'}
              </span>
            ) : null}
          </div>

          {!cart.ready ? (
            // The server cannot see localStorage, so it must not answer for the
            // cart. Before the browser has read it, say that and nothing else.
            <p className="mt-2 mb-0 text-[13px] leading-[1.55] text-gink-64">
              Reading the order saved on this phone&hellip;
            </p>
          ) : showingQty === 0 ? (
            <p className="mt-2 mb-0 text-[13px] leading-[1.55] text-gink-64">
              There is nothing in this cart yet.{' '}
              <Link
                href={`/menu?s=${encodeURIComponent(slug)}`}
                className="font-semibold text-[var(--p-accent)] underline underline-offset-2"
              >
                Open the menu
              </Link>{' '}
              and add a dish — it will still be here when you come back.
            </p>
          ) : (
            <>
              <ul className="m-0 mt-2 list-none divide-y divide-hair p-0">
                {priced.lines.map((line) => (
                  <li key={`${line.itemId}|${line.variantId ?? ''}`} className="flex gap-3 py-2">
                    <span className="tnum w-7 shrink-0 text-[13px] text-gink-64">{line.qty}×</span>
                    <span className="min-w-0 flex-1 text-[13px] leading-[1.45] text-gink">
                      {line.name}
                      {line.variantName ? (
                        <em className="text-[12px] text-gink-46 not-italic"> · {line.variantName}</em>
                      ) : null}
                    </span>
                    <span className="tnum shrink-0 text-[13px] font-semibold text-gink">
                      {inr(paiseToRupees(line.lineTotalPaise))}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-baseline justify-between border-t border-hair pt-2.5 text-[15px] font-semibold text-gink">
                <span>Total payable</span>
                <span className="tnum">{inr(paiseToRupees(showingTotal))}</span>
              </div>
              <p className="mt-2 mb-0 text-[11.5px] leading-[1.5] text-gink-46">
                Nothing has been sent to the kitchen and nothing has been charged. The bill is
                written when you place the order.
              </p>
            </>
          )}
        </section>

        <WhereToFindCode windowMinutes={windowMinutes} />

        <VerifyCodeForm
          token={token}
          windowMinutes={windowMinutes}
          next={next}
          cta="Place the order"
        />

        <p className="mt-4 text-[12px] leading-[1.55] text-gink-46">
          Rather not type a code? A member of staff can take this order at the counter — your cart
          stays on this phone either way.
        </p>
      </div>
    </GuestFlow>
  );
}
