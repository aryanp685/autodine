'use client';

import Link from 'next/link';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import { priceCart, type MenuItemPrice } from '@/lib/cart-pricing';
import { gstLabel } from '@/lib/pricing';

function Totals({ subtotalPaise, taxPaise, totalPaise, taxRateBps, compact }: {
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  /** The restaurant's own rate; absent means the bill is priced at a sample. */
  taxRateBps?: number;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'totals totals--compact' : 'totals'}>
      <div className="totals__row">
        <span>Subtotal</span>
        <span className="tnum">{inr(paiseToRupees(subtotalPaise))}</span>
      </div>
      <div className="totals__row">
        <span>Taxes ({gstLabel(taxRateBps)})</span>
        <span className="tnum">{inr(paiseToRupees(taxPaise))}</span>
      </div>
      <div className="totals__row totals__row--total">
        <span>Total</span>
        <span className="tnum">{inr(paiseToRupees(totalPaise))}</span>
      </div>
      {/* Only when there is no restaurant rate to price against. This note
          used to render for every guest, including one sitting in a real
          restaurant with a real GST rate, and told them the tax they were
          about to pay was a layout sample. On a demo it is true and worth
          saying; on a live menu it is a lie about someone's bill. */}
      {taxRateBps === undefined && (
        <p className="totals__note">
          This menu has no tax rate configured, so the tax above is a sample for layout review rather than a
          rate the restaurant set.
        </p>
      )}
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

  const withSlug = (path: string) => (slug ? `${path}?s=${encodeURIComponent(slug)}` : path);
  const priced = priceCart(cart.lines, items, taxRateBps);
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
                // Keyed by portion too. Keying by item alone collapsed a
                // half and a full plate of the same dish onto one React
                // element, so changing one quantity re-rendered the other.
                <div
                  key={`${l.itemId}|${l.variantId ?? ''}|${(l.addonIds ?? []).join(',')}`}
                  className="cart__line"
                >
                  <div className="cart__lineMain">
                    <div className="cart__lineTop">
                      <VegMark veg={l.isVeg} />
                      <strong>{l.name}</strong>
                    </div>
                    <div className="cart__linePrice tnum">
                      {l.variantName ? `${l.variantName} · ` : ''}
                      {inr(paiseToRupees(l.unitPricePaise))} each
                    </div>
                    {/* The add-ons the guest picked, named. A line total that
                        is higher than the menu price with no reason on screen
                        reads as a wrong bill. */}
                    {l.addonNames && l.addonNames.length > 0 && (
                      <div className="cart__lineAddons">
                        + {l.addonNames.join(' · ')}
                        {l.addonPaise ? ` (${inr(paiseToRupees(l.addonPaise))} each)` : ' (free)'}
                      </div>
                    )}
                  </div>
                  <div className="cart__qty">
                    <button
                      onClick={() => cart.setQty(l.itemId, l.qty - 1, l.variantId, l.addonIds)}
                      aria-label={`Decrease ${l.name}`}
                    >
                      −
                    </button>
                    <span className="tnum">{l.qty}</span>
                    <button
                      onClick={() => cart.setQty(l.itemId, l.qty + 1, l.variantId, l.addonIds)}
                      aria-label={`Increase ${l.name}`}
                    >
                      +
                    </button>
                  </div>
                  <div className="cart__lineEnd">
                    <div className="cart__lineTotal tnum">
                      {inr(paiseToRupees(l.lineTotalPaise))}
                    </div>
                    <button
                      type="button"
                      className="cart__remove"
                      onClick={() => cart.remove(l.itemId, l.variantId, l.addonIds)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}

              {cart.lines.length === 0 && (
                <div className="cart__empty">
                  <p>Your cart is empty — nothing has been added from the menu yet.</p>
                  <Link href={withSlug('/menu')} className="cart__emptyCta">
                    Open the menu
                  </Link>
                </div>
              )}

              {dropped > 0 && (
                <div className="cart__notice">
                  {dropped === 1 ? 'One item is' : `${dropped} items are`} no longer
                  available, so {dropped === 1 ? 'it is' : 'they are'} not on the bill.
                </div>
              )}

              {/*
                A portion that no longer exists is kept and priced at the menu
                price rather than dropped -- losing the line would lose the
                sale over a menu edit. But the guest has to be told, because
                they chose a cheaper portion and are now being billed the
                dearer one.
              */}
              {/* An add-on the restaurant has since removed is not charged.
                  Saying so is the difference between a bill the guest can
                  check and one they have to take on trust. */}
              {priced.staleAddonIds.length > 0 && (
                <div className="cart__notice">
                  {priced.staleAddonIds.length === 1
                    ? 'One add-on you picked is'
                    : `${priced.staleAddonIds.length} add-ons you picked are`}{' '}
                  no longer on the menu, so {priced.staleAddonIds.length === 1 ? 'it is' : 'they are'}{' '}
                  not on the bill.
                </div>
              )}

              {priced.staleVariantIds.length > 0 && (
                <div className="cart__notice">
                  The portion you picked for{' '}
                  {priced.staleVariantIds.length === 1 ? 'one dish is' : 'some dishes is'} no
                  longer on the menu, so {priced.staleVariantIds.length === 1 ? 'it is' : 'they are'}{' '}
                  priced at the menu price. Please check the bill before paying.
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
              taxRateBps={taxRateBps}
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

      {/*
        Phones only. The bill sits below the lines on a narrow screen, which
        puts "Continue to checkout" past the end of a long order -- the one
        button on the page, out of reach. This bar is the same destination,
        always at the bottom, with the number the guest is deciding about.
      */}
      {priced.lines.length > 0 && (
        <div className="cart__bar">
          <span className="cart__barTotal">
            <span className="cart__barLabel">Total</span>
            <strong className="tnum">{inr(paiseToRupees(totalPaise))}</strong>
          </span>
          <Link href={withSlug('/menu/checkout')} className="cart__barCta">
            Checkout
          </Link>
        </div>
      )}
    </div>
  );
}
