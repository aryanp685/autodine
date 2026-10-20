'use client';

import Link from 'next/link';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { lineTotal, paiseToRupees } from '@/lib/money';

function Totals({ compact }: { compact?: boolean }) {
  const cart = useCart();
  const { subtotalPaise, taxPaise, totalPaise } = cart.totals;
  return (
    <div className={compact ? 'totals totals--compact' : 'totals'}>
      <div className="totals__row">
        <span>Subtotal</span>
        <span className="tnum">{inr(paiseToRupees(subtotalPaise))}</span>
      </div>
      <div className="totals__row">
        <span>GST (5% preview rate)</span>
        <span className="tnum">{inr(paiseToRupees(taxPaise))}</span>
      </div>
      <div className="totals__row totals__row--total">
        <span>Total</span>
        <span className="tnum">{inr(paiseToRupees(totalPaise))}</span>
      </div>
      <p className="totals__note">
        Preview uses one 5% restaurant-service rate (local split: CGST 2.5% + SGST 2.5%). The venue’s GST
        status is unverified; confirm it before live billing.
      </p>
    </div>
  );
}

/* Option A — editorial two-column cart */
export function Cart() {
  const cart = useCart();
  return (
    <div className="cart">
      <header className="cart__head">
        <Link href={`/menu?s=${encodeURIComponent(cart.scope)}`} className="cart__back">
          ← Back to menu
        </Link>
        <h1>Your order</h1>
        <p>Preview cart · {cart.count} items · order submission is not connected</p>
      </header>

      <div className="cart__grid">
        <div className="cart__lines">
          {cart.lines.map((l) => (
            <div key={l.key} className="cart__line">
              <div className="cart__lineMain">
                <div className="cart__lineTop">
                  <VegMark veg={l.veg} />
                  <strong>{l.name}</strong>
                </div>
                {l.variant && <div className="cart__lineMeta">{l.variant}</div>}
                {l.addons && l.addons.length > 0 && <div className="cart__lineMeta">{l.addons.join(' · ')}</div>}
                <div className="cart__linePrice tnum">{inr(paiseToRupees(l.unitPricePaise))} each</div>
              </div>
              <div className="cart__qty">
                <button type="button" onClick={() => cart.setQty(l.key, l.qty - 1)} aria-label={`Decrease ${l.name} quantity`}>−</button>
                <span className="tnum">{l.qty}</span>
                <button type="button" onClick={() => cart.setQty(l.key, l.qty + 1)} aria-label={`Increase ${l.name} quantity`}>+</button>
              </div>
              <div className="cart__lineTotal tnum">{inr(paiseToRupees(lineTotal(l.unitPricePaise, l.qty)))}</div>
            </div>
          ))}
          {cart.lines.length === 0 && <div className="cart__empty">Your cart is empty — add something from the menu.</div>}
        </div>

        <aside className="cart__sum">
          <div className="cart__sumCard">
            <h2>Bill summary</h2>
            <Totals />
            {cart.lines.length > 0 ? (
              <Link href={`/menu/checkout?s=${encodeURIComponent(cart.scope)}`} className="cart__cta">Continue to checkout</Link>
            ) : (
              <Link href={`/menu?s=${encodeURIComponent(cart.scope)}`} className="cart__cta">Browse the menu</Link>
            )}
            <div className="cart__fine">
              Demo — not saved. This cart uses browser-only state; no order is sent to a restaurant.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
