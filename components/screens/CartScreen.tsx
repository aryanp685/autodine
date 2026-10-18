'use client';

import Link from 'next/link';
import { useCart } from '@/components/CartProvider';
import { inr, restaurant } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';

const SAMPLE_TAX_RATE = 0.05; // sample only — real tax configuration still to be confirmed

function Totals({ compact }: { compact?: boolean }) {
  const cart = useCart();
  const tax = Math.round(cart.subtotal * SAMPLE_TAX_RATE * 100) / 100;
  const total = Math.round((cart.subtotal + tax) * 100) / 100;
  return (
    <div className={compact ? 'totals totals--compact' : 'totals'}>
      <div className="totals__row">
        <span>Subtotal</span>
        <span className="tnum">{inr(cart.subtotal)}</span>
      </div>
      <div className="totals__row">
        <span>Taxes (GST 5% · sample)</span>
        <span className="tnum">{inr(tax)}</span>
      </div>
      <div className="totals__row totals__row--total">
        <span>Total</span>
        <span className="tnum">{inr(total)}</span>
      </div>
      <p className="totals__note">
        Tax rates shown are sample values for layout review. Final tax configuration must be confirmed before
        launch.
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
        <Link href={`/menu`} className="cart__back">
          ← Back to menu
        </Link>
        <h1>Your order</h1>
        <p>
          {restaurant.name} · Table 7 · on-site verified 12:41 PM
        </p>
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
                <div className="cart__linePrice tnum">{inr(l.unitPrice)} each</div>
              </div>
              <div className="cart__qty">
                <button onClick={() => cart.setQty(l.key, l.qty - 1)} aria-label="Decrease">−</button>
                <span className="tnum">{l.qty}</span>
                <button onClick={() => cart.setQty(l.key, l.qty + 1)} aria-label="Increase">+</button>
              </div>
              <div className="cart__lineTotal tnum">{inr(l.qty * l.unitPrice)}</div>
            </div>
          ))}
          {cart.lines.length === 0 && <div className="cart__empty">Your cart is empty — add something from the menu.</div>}
        </div>

        <aside className="cart__sum">
          <div className="cart__sumCard">
            <h2>Bill summary</h2>
            <Totals />
            <Link href={`/menu/checkout`} className="cart__cta">
              Continue to checkout
            </Link>
            <div className="cart__fine">
              Totals are recalculated by the server before payment. This screen shows sample values.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
