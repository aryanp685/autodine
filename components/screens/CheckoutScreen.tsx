'use client';

import Link from 'next/link';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import { priceCart, type MenuItemPrice } from '@/lib/cart-pricing';
import { placeOrderAction } from '@/app/menu/checkout/actions';
import { gstLabel } from '@/lib/pricing';

/**
 * Checkout.
 *
 * One path, and it is the same order either way: the order goes to the kitchen
 * immediately, marked payment pending. What differs is what happens next, and
 * the screen says which.
 *
 *   counter  the guest pays the cashier, who records it at the till.
 *   online   the guest pays by card/UPI on their own order page, straight
 *            after placing, and the order is marked paid only when the
 *            gateway confirms it.
 *
 * No payment choice is made HERE, because none can be: the order has to exist
 * before it can be paid. Drawing "Pay online" as a selectable option would
 * promise a card sheet this screen cannot open.
 */
export function Checkout({
  slug,
  restaurantName,
  taxRateBps,
  items,
  onlinePaymentAvailable = false,
}: {
  slug?: string;
  restaurantName?: string;
  /** The restaurant's own rate. Without it the bill is priced at a sample. */
  taxRateBps?: number;
  items: MenuItemPrice[];
  /**
   * Owner switch AND a gateway this deployment can verify with. False means
   * the guest is told the counter is how payment happens -- including when an
   * owner has switched it on but the server has no keys.
   */
  onlinePaymentAvailable?: boolean;
}) {
  const cart = useCart();
  const priced = priceCart(cart.lines, items, taxRateBps);
  const { subtotalPaise, taxPaise, totalPaise } = priced.totals;

  const withSlug = (path: string) => (slug ? `${path}?s=${encodeURIComponent(slug)}` : path);
  const canOrder = cart.ready && priced.lines.length > 0;

  return (
    // The phone bar repeats this bill's total at the bottom of the screen.
    // When it is showing, the same button inside the summary is hidden by CSS,
    // so a guest never sees two black buttons 40px apart. The class says
    // whether the bar exists, because CSS cannot ask.
    <div className={canOrder ? 'co co--barred' : 'co'}>
      <header className="co__head">
        <Link href={withSlug('/menu/cart')} className="co__back">
          ← Back to cart
        </Link>
        <h1>Checkout</h1>
        {/* The count appears once the stored cart has been read. Until then
            it would read "0 items" over an order that is still loading. */}
        <p>
          {restaurantName ?? 'Your table'}
          {cart.ready && cart.count > 0
            ? ` · ${cart.count} ${cart.count === 1 ? 'item' : 'items'}`
            : null}
        </p>
      </header>

      <div className="co__grid">
        <div>
          {/*
            ONE method, stated, not two buttons with one of them disabled.

            This used to be a pair of cards -- "Pay at counter" already selected
            and unclickable, next to "Pay online" greyed out. Two dead controls
            in the most important moment of the flow read as a broken page: a
            guest taps the second one and concludes the checkout does not work.
            There is no choice to make here, because an order has to exist
            before it can be paid for, so the screen states the one thing that
            will happen and says plainly what comes next.
          */}
          <h2 className="co__h2">How you will pay</h2>

          <div className="co__pay">
            <div className="co__payRow">
              <span className="co__payMark" aria-hidden="true" />
              <div>
                <strong>At the counter</strong>
                <span>Cash · Card · UPI</span>
              </div>
            </div>
            <p className="co__payNote">
              Your order goes to the kitchen straight away and is marked payment pending. Pay the
              cashier before you leave; the receipt is issued once the payment is recorded.
            </p>
            <p className="co__payNote co__payNote--soft">
              {onlinePaymentAvailable
                ? 'This restaurant also takes card or UPI online, on the order page you reach after placing — the order is marked paid only when the gateway confirms it.'
                : 'Card and UPI are accepted at the counter. Nothing is charged from your phone.'}
            </p>
          </div>

          <h2 className="co__h2">Your order</h2>
          <ul className="co__items">
            {priced.lines.map((l) => (
              // Keyed by portion as well as item: two portions of one dish
              // are two rows, and keying only by item made them collide.
              <li key={`${l.itemId}|${l.variantId ?? ''}|${(l.addonIds ?? []).join(',')}`}>
                <VegMark veg={l.isVeg} />
                <span>
                  <strong>{l.qty} ×</strong> {l.name}
                  {l.variantName ? <em className="co__variant"> · {l.variantName}</em> : null}
                  {l.addonNames && l.addonNames.length > 0 ? (
                    <em className="co__variant"> · {l.addonNames.join(', ')}</em>
                  ) : null}
                </span>
                <span className="tnum">{inr(paiseToRupees(l.lineTotalPaise))}</span>
              </li>
            ))}
            {cart.ready && priced.lines.length === 0 && (
              <li className="co__empty">Nothing to order yet — add something from the menu.</li>
            )}
          </ul>

          <form id="co-place-order" action={placeOrderAction} className="co__noteForm">
            <input type="hidden" name="slug" value={slug ?? ''} />
            {/* Only ids and quantities go to the server. The prices are read
                from the database when the order is written. */}
            <input type="hidden" name="lines" value={JSON.stringify(cart.lines)} />
            <label className="ui-field">
              <span className="ui-label">Anything the kitchen should know?</span>
              <textarea
                className="ui-input"
                name="note"
                rows={2}
                maxLength={300}
                placeholder="No onion in the raita, less chilli…"
              />
            </label>
          </form>
        </div>

        <aside className="co__sum">
          <h2>Bill</h2>
          <div className="co__row">
            <span>Subtotal</span>
            <span className="tnum">{inr(paiseToRupees(subtotalPaise))}</span>
          </div>
          <div className="co__row">
            <span>Taxes ({gstLabel(taxRateBps)})</span>
            <span className="tnum">{inr(paiseToRupees(taxPaise))}</span>
          </div>
          <div className="co__row co__row--total">
            <span>Total payable</span>
            <span className="tnum">{inr(paiseToRupees(totalPaise))}</span>
          </div>

          <button
            type="submit"
            form="co-place-order"
            className="co__cta"
            disabled={!canOrder}
          >
            {!canOrder ? 'Add items before checkout' : `Place order · ${inr(paiseToRupees(totalPaise))}`}
          </button>
          <p className="co__fine" role="note">
            {onlinePaymentAvailable
              ? 'Pay at the counter, or by card/UPI on the next screen. The kitchen starts straight away either way.'
              : 'You pay at the counter. The kitchen starts on this straight away.'}
          </p>
        </aside>
      </div>

      {/* Phones only: the bill is below the order on a narrow screen, so the
          one button that completes the flow would otherwise be off-screen.
          It submits the same form from here. */}
      {canOrder && (
        <div className="co__bar">
          <span className="co__barTotal">
            <span className="co__barLabel">Total</span>
            <strong className="tnum">{inr(paiseToRupees(totalPaise))}</strong>
          </span>
          <button type="submit" form="co-place-order" className="co__barCta">
            Place order
          </button>
        </div>
      )}
    </div>
  );
}
