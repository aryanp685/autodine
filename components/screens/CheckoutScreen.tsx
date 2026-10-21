'use client';

import Link from 'next/link';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import { priceCart, type MenuItemPrice } from '@/lib/cart-pricing';
import { placeOrderAction } from '@/app/menu/checkout/actions';

/**
 * Checkout, with one honest gap.
 *
 * Paying at the counter works: the order goes to the kitchen marked payment
 * pending, and the cashier records the payment when it happens. That is the
 * whole loop and it is real.
 *
 * Paying online does not exist yet -- the payment provider's KYC is not
 * finished, so there is nothing to charge against. It is shown as unavailable
 * rather than as a button that fails on press. A control that looks live and
 * then errors is worse than one that plainly is not ready.
 */
export function Checkout({
  slug,
  restaurantName,
  taxRateBps,
  items,
}: {
  slug?: string;
  restaurantName?: string;
  /** The restaurant's own rate. Without it the bill is priced at a sample. */
  taxRateBps?: number;
  items: MenuItemPrice[];
}) {
  const cart = useCart();
  const priced = priceCart(cart.lines, items, taxRateBps);
  const { subtotalPaise, taxPaise, totalPaise } = priced.totals;

  const withSlug = (path: string) => (slug ? `${path}?s=${encodeURIComponent(slug)}` : path);
  const canOrder = cart.ready && priced.lines.length > 0;

  return (
    <div className="co">
      <header className="co__head">
        <Link href={withSlug('/menu/cart')} className="co__back">
          ← Back to cart
        </Link>
        <h1>Checkout</h1>
        <p>
          {restaurantName ?? 'Your table'} · {cart.count} item{cart.count === 1 ? '' : 's'}
        </p>
      </header>

      <div className="co__grid">
        <div>
          <h2 className="co__h2">How would you like to pay?</h2>

          <div className="co__methods">
            <button
              type="button"
              className="co__method is-on"
              aria-pressed="true"
              disabled
              // Not a choice yet: it is the only way to pay, so it reads as
              // selected and inactive rather than as one of two options.
            >
              <div className="co__methodTop">
                <strong>Pay at counter</strong>
                <span>Cash · Card · UPI</span>
              </div>
              <p>
                Your order goes to the kitchen straight away, marked payment pending.
                Pay the cashier before you leave; the receipt is issued once the payment
                is recorded.
              </p>
            </button>

            <button type="button" className="co__method" aria-disabled="true" disabled>
              <div className="co__methodTop">
                <strong>Pay online</strong>
                <span>Not connected yet</span>
              </div>
              <p>
                Online payment needs our payment provider&rsquo;s verification to finish.
                Until it does, orders are placed and paid at the counter.
              </p>
            </button>
          </div>

          <h2 className="co__h2">Your order</h2>
          <ul className="co__items">
            {priced.lines.map((l) => (
              <li key={l.itemId}>
                <VegMark veg={l.isVeg} />
                <span>
                  <strong>{l.qty} ×</strong> {l.name}
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
            <span>Taxes (GST 5% · sample)</span>
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
            You pay at the counter. The kitchen starts on this straight away.
          </p>
        </aside>
      </div>
    </div>
  );
}
