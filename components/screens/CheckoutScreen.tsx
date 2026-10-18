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

function MethodChoice({ value, onChange, variant }: { value: 'online' | 'counter'; onChange: (v: 'online' | 'counter') => void; variant: 'a' | 'b' | 'c' }) {
  return (
    <div className={`${variant}-co__methods`}>
      <button
        className={`${variant}-co__method ${value === 'online' ? 'is-on' : ''}`}
        onClick={() => onChange('online')}
        aria-pressed={value === 'online'}
      >
        <div className={`${variant}-co__methodTop`}>
          <strong>Pay online</strong>
          <span>UPI · Cards · Netbanking</span>
        </div>
        <p>We confirm payment with the provider before the order is sent to the kitchen.</p>
      </button>
      <button
        className={`${variant}-co__method ${value === 'counter' ? 'is-on' : ''}`}
        onClick={() => onChange('counter')}
        aria-pressed={value === 'counter'}
      >
        <div className={`${variant}-co__methodTop`}>
          <strong>Pay at counter</strong>
          <span>Cash · Card on device</span>
        </div>
        <p>The order goes to the kitchen marked payment pending. The cashier records it when you pay.</p>
      </button>
    </div>
  );
}

/* Option A — editorial checkout */
export function CheckoutA({ dir }: { dir: string }) {
  const cart = useCart();
  const t = useTotals();
  const [method, setMethod] = useState<'online' | 'counter'>('online');

  return (
    <div className="a-co">
      <header className="a-co__head">
        <Link href={`/design/${dir}/cart`} className="a-co__back">
          ← Back to cart
        </Link>
        <h1>Checkout</h1>
        <p>
          {restaurant.name} · Table 7 · {t.count} items
        </p>
      </header>

      <div className="a-co__grid">
        <div>
          <h2 className="a-co__h2">How would you like to pay?</h2>
          <MethodChoice value={method} onChange={setMethod} variant="a" />

          <div className="a-co__note">
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

          <h2 className="a-co__h2">Order for Table 7</h2>
          <ul className="a-co__items">
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

        <aside className="a-co__sum">
          <h2>Bill</h2>
          <div className="a-co__row">
            <span>Subtotal</span>
            <span className="tnum">{inr(t.subtotal)}</span>
          </div>
          <div className="a-co__row">
            <span>Taxes (sample)</span>
            <span className="tnum">{inr(t.tax)}</span>
          </div>
          <div className="a-co__row a-co__row--total">
            <span>Total payable</span>
            <span className="tnum">{inr(t.total)}</span>
          </div>
          <button className="a-co__cta">{method === 'online' ? `Pay ${inr(t.total)}` : `Place order · ${inr(t.total)}`}</button>
          <p className="a-co__fine">
            Prototype button — no payment provider is connected and no charge is made.
          </p>
        </aside>
      </div>
    </div>
  );
}

/* Option B — compact operations checkout with explicit state preview */
export function CheckoutB({ dir }: { dir: string }) {
  const cart = useCart();
  const t = useTotals();
  const [method, setMethod] = useState<'online' | 'counter'>('online');
  const [sim, setSim] = useState<'idle' | 'waiting' | 'paid' | 'pending'>('idle');

  return (
    <div className="b-co">
      <header className="b-co__top">
        <Link href={`/design/${dir}/cart`} className="b-co__back">
          ←
        </Link>
        <strong>Checkout</strong>
        <span className="b-co__meta">T7 · {t.count} items · {inr(t.total)}</span>
        <span className="b-co__secure">🔒 Secure</span>
      </header>

      <div className="b-co__body">
        <div className="b-co__main">
          <div className="b-co__sectionHead">
            <h2>Payment method</h2>
            <span>2 options</span>
          </div>
          <MethodChoice value={method} onChange={setMethod} variant="b" />

          <div className="b-co__sectionHead">
            <h2>Order summary</h2>
            <span>Table 7</span>
          </div>
          <ul className="b-co__items">
            {cart.lines.map((l) => (
              <li key={l.key}>
                <VegMark veg={l.veg} />
                <span className="b-co__itemName">
                  <strong>{l.qty}×</strong> {l.name}
                  {(l.variant || l.addons) && (
                    <em>{[l.variant, ...(l.addons ?? [])].filter(Boolean).join(' · ')}</em>
                  )}
                </span>
                <span className="tnum">{inr(l.qty * l.unitPrice)}</span>
              </li>
            ))}
          </ul>
          <div className="b-co__rows">
            <div>
              <span>Subtotal</span>
              <span className="tnum">{inr(t.subtotal)}</span>
            </div>
            <div>
              <span>Taxes (sample)</span>
              <span className="tnum">{inr(t.tax)}</span>
            </div>
            <div className="is-total">
              <span>Total</span>
              <span className="tnum">{inr(t.total)}</span>
            </div>
          </div>
        </div>

        <aside className="b-co__side">
          <div className="b-co__card">
            <div className="b-co__cardHead">Place order</div>
            <button className="b-co__cta">{method === 'online' ? `Pay ${inr(t.total)}` : `Send to kitchen`}</button>
            <p className="b-co__fine">Prototype only — no provider connected.</p>

            <div className="b-co__divider" />

            <div className="b-co__cardHead">Preview the next state</div>
            <div className="b-co__sim">
              {(
                [
                  ['waiting', 'Online · waiting for provider confirmation'],
                  ['paid', 'Online · payment verified'],
                  ['pending', 'Counter · payment pending'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={`b-co__simBtn ${sim === k ? 'is-on' : ''}`} onClick={() => setSim(k)}>
                  {label}
                </button>
              ))}
            </div>

            {sim === 'waiting' && (
              <div className="b-co__stateBox is-waiting">
                <div className="b-co__spinner" />
                <div>
                  <strong>Waiting for payment confirmation…</strong>
                  <p>
                    Your order is not sent to the kitchen yet. We are checking with the payment provider. Please
                    keep this screen open.
                  </p>
                </div>
              </div>
            )}
            {sim === 'paid' && (
              <div className="b-co__stateBox is-paid">
                <div>
                  <strong>✓ Payment verified · Order A-1042 confirmed</strong>
                  <p>Sent to the kitchen and queued for announcement. Receipt is ready.</p>
                  <div className="b-co__stateActions">
                    <span className="b-co__miniBtn">Track order</span>
                    <span className="b-co__miniBtn">View receipt</span>
                  </div>
                </div>
              </div>
            )}
            {sim === 'pending' && (
              <div className="b-co__stateBox is-pending">
                <div>
                  <strong>Order A-1042 sent · payment pending at counter</strong>
                  <p>
                    The kitchen has your order. It is clearly marked unpaid until the cashier records your
                    payment.
                  </p>
                  <div className="b-co__stateActions">
                    <span className="b-co__miniBtn">Track order</span>
                    <span className="b-co__miniBtn">Amount due {inr(t.total)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* Option C — warm checkout */
export function CheckoutC({ dir }: { dir: string }) {
  const cart = useCart();
  const t = useTotals();
  const [method, setMethod] = useState<'online' | 'counter'>('counter');

  return (
    <div className="c-co">
      <header className="c-co__head">
        <Link href={`/design/${dir}/cart`} className="c-co__back">
          ←
        </Link>
        <h1>Almost there</h1>
        <div className="c-co__steps">
          <span>Menu</span>
          <i>·</i>
          <span>Cart</span>
          <i>·</i>
          <span className="is-on">Pay</span>
        </div>
      </header>

      <div className="c-co__panel">
        <h2>Choose how you&apos;d like to pay</h2>
        <MethodChoice value={method} onChange={setMethod} variant="c" />

        <div className="c-co__order">
          <h3>Your order · Table 7</h3>
          {cart.lines.map((l) => (
            <div key={l.key} className="c-co__line">
              <VegMark veg={l.veg} />
              <span>
                <strong>{l.qty}×</strong> {l.name}
              </span>
              <span className="tnum">{inr(l.qty * l.unitPrice)}</span>
            </div>
          ))}
          <div className="c-co__totalRow">
            <span>Subtotal</span>
            <span className="tnum">{inr(t.subtotal)}</span>
          </div>
          <div className="c-co__totalRow">
            <span>Taxes (sample)</span>
            <span className="tnum">{inr(t.tax)}</span>
          </div>
          <div className="c-co__totalRow is-total">
            <span>Total</span>
            <span className="tnum">{inr(t.total)}</span>
          </div>
        </div>

        <button className="c-co__cta">
          {method === 'online' ? `Pay ${inr(t.total)} securely` : `Send order · pay ${inr(t.total)} at counter`}
        </button>
        <p className="c-co__fine">
          {method === 'online'
            ? 'You will be handed to the payment provider. We confirm on our server before the kitchen sees your order.'
            : 'Your order reaches the kitchen right away, marked payment pending until the cashier records it.'}
        </p>
      </div>
    </div>
  );
}
