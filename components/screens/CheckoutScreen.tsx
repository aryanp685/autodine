'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { lineTotal, paiseToRupees } from '@/lib/money';

function useTotals() {
  // All arithmetic lives in lib/pricing. The browser never computes a total.
  return useCart().totals;
}

function MethodChoice({ value, onChange }: { value: 'online' | 'counter'; onChange: (v: 'online' | 'counter') => void }) {
  return (
        <div className={`co__methods`}>
      <button
        type="button"
        className={`co__method ${value === 'online' ? 'is-on' : ''}`}
        onClick={() => onChange('online')}
        aria-pressed={value === 'online'}
      >
        <div className={`co__methodTop`}>
          <strong>Pay online</strong>
          <span>Not connected</span>
        </div>
        <p>Online payment is not connected in this preview; no charge or order is sent.</p>
      </button>
      <button
        type="button"
        className={`co__method ${value === 'counter' ? 'is-on' : ''}`}
        onClick={() => onChange('counter')}
        aria-pressed={value === 'counter'}
      >
        <div className={`co__methodTop`}>
          <strong>Pay at counter</strong>
          <span>Not connected to guest checkout</span>
        </div>
        <p>This preview does not submit an order or record a counter payment.</p>
      </button>
    </div>
  );
}

/* Option A — editorial checkout */
export function Checkout() {
  const cart = useCart();
  const t = useTotals();
  const [method, setMethod] = useState<'online' | 'counter'>('online');
  const [previewNotice, setPreviewNotice] = useState('');

  return (
    <div className="co">
      <header className="co__head">
        <Link href={`/menu/cart?s=${encodeURIComponent(cart.scope)}`} className="co__back">
          ← Back to cart
        </Link>
        <h1>Checkout</h1>
        <p>Demo checkout · {cart.count} items · no order or payment is submitted</p>
      </header>

      <div className="co__grid">
        <div>
          <h2 className="co__h2">How would you like to pay?</h2>
          <MethodChoice value={method} onChange={setMethod} />

          <div className="co__note">
            {method === 'online' ? (
              <>
                <strong>Preview only:</strong> there is no payment provider or order submission connected here.
              </>
            ) : (
              <>
                <strong>Preview only:</strong> this choice does not send an order to the kitchen or create a receipt.
              </>
            )}
          </div>

          <h2 className="co__h2">Sample cart</h2>
          <ul className="co__items">
            {cart.lines.map((l) => (
              <li key={l.key}>
                <VegMark veg={l.veg} />
                <span>
                  <strong>{l.qty} ×</strong> {l.name}
                </span>
                <span className="tnum">{inr(paiseToRupees(lineTotal(l.unitPricePaise, l.qty)))}</span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="co__sum">
          <h2>Bill</h2>
          <div className="co__row">
            <span>Subtotal</span>
            <span className="tnum">{inr(paiseToRupees(t.subtotalPaise))}</span>
          </div>
          <div className="co__row">
            <span>GST (5% preview rate)</span>
            <span className="tnum">{inr(paiseToRupees(t.taxPaise))}</span>
          </div>
          <div className="co__row co__row--total">
            <span>Total payable</span>
            <span className="tnum">{inr(paiseToRupees(t.totalPaise))}</span>
          </div>
          {cart.lines.length === 0 ? (
            <Link className="co__cta" href={`/menu?s=${encodeURIComponent(cart.scope)}`}>Return to the menu</Link>
          ) : (
            <button
              className="co__cta"
              type="button"
              onClick={() => setPreviewNotice('Preview only — no order was sent and no payment was taken.')}
            >
              {method === 'online'
                ? `Preview payment · ${inr(paiseToRupees(t.totalPaise))}`
                : `Preview order · ${inr(paiseToRupees(t.totalPaise))}`}
            </button>
          )}
          {previewNotice && <p className="co__fine" role="status">{previewNotice}</p>}
          <p className="co__fine" role="note">
            Preview only. No order is submitted, no payment provider is connected and no charge is made. The 5% GST
            rate is a common standalone-restaurant preview assumption, not verified for this venue.
          </p>
        </aside>
      </div>
    </div>
  );
}
