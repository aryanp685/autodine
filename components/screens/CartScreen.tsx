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
export function CartA({ dir }: { dir: string }) {
  const cart = useCart();
  return (
    <div className="a-cart">
      <header className="a-cart__head">
        <Link href={`/design/${dir}/customer-menu`} className="a-cart__back">
          ← Back to menu
        </Link>
        <h1>Your order</h1>
        <p>
          {restaurant.name} · Table 7 · on-site verified 12:41 PM
        </p>
      </header>

      <div className="a-cart__grid">
        <div className="a-cart__lines">
          {cart.lines.map((l) => (
            <div key={l.key} className="a-cart__line">
              <div className="a-cart__lineMain">
                <div className="a-cart__lineTop">
                  <VegMark veg={l.veg} />
                  <strong>{l.name}</strong>
                </div>
                {l.variant && <div className="a-cart__lineMeta">{l.variant}</div>}
                {l.addons && l.addons.length > 0 && <div className="a-cart__lineMeta">{l.addons.join(' · ')}</div>}
                <div className="a-cart__linePrice tnum">{inr(l.unitPrice)} each</div>
              </div>
              <div className="a-cart__qty">
                <button onClick={() => cart.setQty(l.key, l.qty - 1)} aria-label="Decrease">−</button>
                <span className="tnum">{l.qty}</span>
                <button onClick={() => cart.setQty(l.key, l.qty + 1)} aria-label="Increase">+</button>
              </div>
              <div className="a-cart__lineTotal tnum">{inr(l.qty * l.unitPrice)}</div>
            </div>
          ))}
          {cart.lines.length === 0 && <div className="a-cart__empty">Your cart is empty — add something from the menu.</div>}
        </div>

        <aside className="a-cart__sum">
          <div className="a-cart__sumCard">
            <h2>Bill summary</h2>
            <Totals />
            <Link href={`/design/${dir}/checkout`} className="a-cart__cta">
              Continue to checkout
            </Link>
            <div className="a-cart__fine">
              Totals are recalculated by the server before payment. This screen shows sample values.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* Option B — compact operations cart */
export function CartB({ dir }: { dir: string }) {
  const cart = useCart();
  return (
    <div className="b-cart">
      <header className="b-cart__top">
        <Link href={`/design/${dir}/customer-menu`} className="b-cart__back">
          ←
        </Link>
        <div>
          <strong>Your order</strong>
          <span className="b-cart__meta">T7 · {restaurant.name} · verified 12:41</span>
        </div>
        <span className="b-cart__count">{cart.count} items</span>
      </header>

      <div className="b-cart__body">
        <table className="b-cart__table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cart.lines.map((l) => (
              <tr key={l.key}>
                <td>
                  <div className="b-cart__item">
                    <VegMark veg={l.veg} />
                    <div>
                      <strong>{l.name}</strong>
                      {(l.variant || l.addons) && (
                        <div className="b-cart__itemMeta">
                          {[l.variant, ...(l.addons ?? [])].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <div className="b-cart__qty">
                    <button onClick={() => cart.setQty(l.key, l.qty - 1)} aria-label="Decrease">−</button>
                    <span className="tnum">{l.qty}</span>
                    <button onClick={() => cart.setQty(l.key, l.qty + 1)} aria-label="Increase">+</button>
                  </div>
                </td>
                <td className="tnum" style={{ textAlign: 'right' }}>
                  {inr(l.qty * l.unitPrice)}
                </td>
                <td>
                  <button className="b-cart__remove" onClick={() => cart.remove(l.key)} aria-label="Remove">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {cart.lines.length === 0 && <div className="b-cart__empty">Cart is empty.</div>}

        <aside className="b-cart__sum">
          <Totals compact />
          <Link href={`/design/${dir}/checkout`} className="b-cart__cta">
            Continue →
          </Link>
        </aside>
      </div>
    </div>
  );
}

/* Option C — warm rounded cart */
export function CartC({ dir }: { dir: string }) {
  const cart = useCart();
  return (
    <div className="c-cart">
      <header className="c-cart__head">
        <Link href={`/design/${dir}/customer-menu`} className="c-cart__back">
          ←
        </Link>
        <h1>Your order</h1>
        <span className="c-cart__chip">Table 7</span>
      </header>

      <div className="c-cart__list">
        {cart.lines.map((l) => (
          <div key={l.key} className="c-cart__card">
            <div className="c-cart__cardMain">
              <div className="c-cart__cardTop">
                <VegMark veg={l.veg} />
                <strong>{l.name}</strong>
              </div>
              {l.variant && <div className="c-cart__cardMeta">{l.variant}</div>}
              {l.addons && l.addons.length > 0 && <div className="c-cart__cardMeta">{l.addons.join(' · ')}</div>}
              <div className="c-cart__cardPrice tnum">{inr(l.qty * l.unitPrice)}</div>
            </div>
            <div className="c-cart__qty">
              <button onClick={() => cart.setQty(l.key, l.qty - 1)} aria-label="Decrease">−</button>
              <span className="tnum">{l.qty}</span>
              <button onClick={() => cart.setQty(l.key, l.qty + 1)} aria-label="Increase">+</button>
            </div>
          </div>
        ))}
        {cart.lines.length === 0 && <div className="c-cart__empty">Nothing here yet.</div>}
        <Link href={`/design/${dir}/customer-menu`} className="c-cart__more">
          + Add more items
        </Link>
      </div>

      <div className="c-cart__bar">
        <Totals compact />
        <Link href={`/design/${dir}/checkout`} className="c-cart__cta">
          Continue to checkout
        </Link>
      </div>
    </div>
  );
}
