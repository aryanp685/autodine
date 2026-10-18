'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/components/CartProvider';
import { inr, restaurant } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';

function useTotals() {
  const cart = useCart();
  const tax = Math.round(cart.subtotal * 0.05 * 100) / 100;
  return { subtotal: cart.subtotal, tax, total: Math.round((cart.subtotal + tax) * 100) / 100, count: cart.count };
}

function MethodChoice({ value, onChange }: { value: 'online' | 'counter'; onChange: (v: 'online' | 'counter') => void }) {
  return (
    <div className={`co__methods`}>
      <button
        className={`co__method ${value === 'online' ? 'is-on' : ''}`}
        onClick={() => onChange('online')}
        aria-pressed={value === 'online'}
      >
        <div className={`co__methodTop`}>
          <strong>Pay online</strong>
          <span>UPI · Cards · Netbanking</span>
        </div>
        <p>We confirm payment with the provider before the order is sent to the kitchen.</p>
      </button>
      <button
        className={`co__method ${value === 'counter' ? 'is-on' : ''}`}
        onClick={() => onChange('counter')}
        aria-pressed={value === 'counter'}
      >
        <div className={`co__methodTop`}>
          <strong>Pay at counter</strong>
          <span>Cash · Card on device</span>
        </div>
        <p>The order goes to the kitchen marked payment pending. The cashier records it when you pay.</p>
      </button>
    </div>
  );
}

/* Option A — editorial checkout */
export function Checkout() {
  const cart = useCart();
  const t = useTotals();
  const [method, setMethod] = useState<'online' | 'counter'>('online');

  return (
    <div className="co">
      <header className="co__head">
        <Link href={`/menu/cart`} className="co__back">
          ← Back to cart
        </Link>
        <h1>Checkout</h1>
        <p>
          {restaurant.name} · Table 7 · {t.count} items
        </p>
      </header>

      <div className="co__grid">
        <div>
          <h2 className="co__h2">How would you like to pay?</h2>
          <MethodChoice value={method} onChange={setMethod} />

          <div className="co__note">
            {method === 'online' ? (
              <>
                <strong>What happens next:</strong> you complete payment with the provider, then we verify it on
                our server. The order only reaches the kitchen after that verification — a success screen on
                your phone is not treated as proof of payment.
              </>
            ) : (
              <>
                <strong>What happens next:</strong> your order goes straight to the kitchen marked
                <em> payment pending</em>. Pay the cashier before you leave; the receipt is issued once the
                payment is recorded.
              </>
            )}
          </div>

          <h2 className="co__h2">Order for Table 7</h2>
          <ul className="co__items">
            {cart.lines.map((l) => (
              <li key={l.key}>
                <VegMark veg={l.veg} />
                <span>
                  <strong>{l.qty} ×</strong> {l.name}
                </span>
                <span className="tnum">{inr(l.qty * l.unitPrice)}</span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="co__sum">
          <h2>Bill</h2>
          <div className="co__row">
            <span>Subtotal</span>
            <span className="tnum">{inr(t.subtotal)}</span>
          </div>
          <div className="co__row">
            <span>Taxes (sample)</span>
            <span className="tnum">{inr(t.tax)}</span>
          </div>
          <div className="co__row co__row--total">
            <span>Total payable</span>
            <span className="tnum">{inr(t.total)}</span>
          </div>
          <button className="co__cta">{method === 'online' ? `Pay ${inr(t.total)}` : `Place order · ${inr(t.total)}`}</button>
          <p className="co__fine">
            Prototype button — no payment provider is connected and no charge is made.
          </p>
        </aside>
      </div>
    </div>
  );
}
