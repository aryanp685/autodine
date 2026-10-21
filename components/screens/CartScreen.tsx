'use client';

import Link from 'next/link';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import { priceCart, type MenuItemPrice } from '@/lib/cart-pricing';

function Totals({ subtotalPaise, taxPaise, totalPaise, compact }: {
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'totals totals--compact' : 'totals'}>
      <div className="totals__row">
        <span>Subtotal</span>
        <span className="tnum">{inr(paiseToRupees(subtotalPaise))}</span>
      </div>
      <div className="totals__row">
        <span>Taxes (GST 5% · sample)</span>
        <span className="tnum">{inr(paiseToRupees(taxPaise))}</span>
      </div>
      <div className="totals__row totals__row--total">
        <span>Total</span>
        <span className="tnum">{inr(paiseToRupees(totalPaise))}</span>
      </div>
      <p className="totals__note">
        Tax rates shown are sample values for layout review. Final tax configuration must be confirmed before
        launch.
      </p>
    </div>
  );
}

/**
 * The cart, priced against the menu the server just read.
 *
 * Names and prices come from `items`, not from the browser: the cart in
 * localStorage holds ids and quantities, so there is no amount there for a
 * customer to change. Anything that has gone missing or sold out since the cart
 * was filled is named rather than quietly dropped -- a dish that vanishes from
 * the bill without a word looks like a mistake.
 */
export function Cart({
  slug,
  restaurantName,
  items,
}: {
  slug?: string;
  restaurantName?: string;
  items: MenuItemPrice[];
}) {
  const cart = useCart();

  const withSlug = (path: string) => (slug ? `${path}?s=${encodeURIComponent(slug)}` : path);
  const priced = priceCart(cart.lines, items);
  const { subtotalPaise, taxPaise, totalPaise } = priced.totals;

  const dropped = priced.missingIds.length + priced.unavailableIds.length;

  return (
    <div className="cart">
      <header className="cart__head">
        <Link href={withSlug('/menu')} className="cart__back">
          ← Back to menu
        </Link>
        <h1>Your order</h1>
        <p>{restaurantName ?? 'Your table'}</p>
      </header>

      <div className="cart__grid">
        <div className="cart__lines">
          {/* The server renders an empty cart because it cannot read
              localStorage. Showing that emptiness for a moment over a cart
              that is not empty reads as the order having been lost. */}
          {!cart.ready ? (
            <div className="cart__empty">Loading your order…</div>
          ) : (
            <>
              {priced.lines.map((l) => (
                <div key={l.itemId} className="cart__line">
                  <div className="cart__lineMain">
                    <div className="cart__lineTop">
                      <VegMark veg={l.isVeg} />
                      <strong>{l.name}</strong>
                    </div>
                    <div className="cart__linePrice tnum">
                      {inr(paiseToRupees(l.unitPricePaise))} each
                    </div>
                  </div>
                  <div className="cart__qty">
                    <button
                      onClick={() => cart.setQty(l.itemId, l.qty - 1)}
                      aria-label={`Decrease ${l.name}`}
                    >
                      −
                    </button>
                    <span className="tnum">{l.qty}</span>
                    <button
                      onClick={() => cart.setQty(l.itemId, l.qty + 1)}
                      aria-label={`Increase ${l.name}`}
                    >
                      +
                    </button>
                  </div>
                  <div className="cart__lineTotal tnum">
                    {inr(paiseToRupees(l.lineTotalPaise))}
                  </div>
                </div>
              ))}

              {cart.lines.length === 0 && (
                <div className="cart__empty">
                  Your cart is empty — add something from the menu.
                </div>
              )}

              {dropped > 0 && (
                <div className="cart__empty">
                  {dropped === 1 ? 'One item is' : `${dropped} items are`} no longer
                  available, so {dropped === 1 ? 'it is' : 'they are'} not on the bill.
                </div>
              )}
            </>
          )}
        </div>

        <aside className="cart__sum">
          <div className="cart__sumCard">
            <h2>Bill summary</h2>
            <Totals
              subtotalPaise={subtotalPaise}
              taxPaise={taxPaise}
              totalPaise={totalPaise}
            />
            {priced.lines.length > 0 ? (
              <Link href={withSlug('/menu/checkout')} className="cart__cta">
                Continue to checkout
              </Link>
            ) : (
              <button type="button" className="cart__cta" disabled>
                Cart is empty
              </button>
            )}
            <div className="cart__fine">
              Prices are read from the kitchen&rsquo;s menu when you order, so the total
              you are charged is the one the restaurant set.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
