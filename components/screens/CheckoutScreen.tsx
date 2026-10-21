'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { placeGuestOrderAction } from '@/app/menu/actions';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { lineTotal, paiseToRupees } from '@/lib/money';
import { formatTaxRatePercent } from '@/lib/tax-settings';

function OrderSubmitButton({ disabled, totalPaise }: { disabled: boolean; totalPaise: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="co__cta" type="submit" disabled={disabled || pending}>
      {pending ? 'Sending order…' : `Place order · ${inr(paiseToRupees(totalPaise))} · pay at counter`}
    </button>
  );
}

const STATUS_MESSAGES: Record<string, { text: string; success?: boolean }> = {
  session: { text: 'Your table session expired. Scan the table QR to start a new ordering session.' },
  'read-only': { text: 'Ordering is temporarily paused for this restaurant. Please ask staff for help.' },
  items: { text: 'One or more items or quantities are invalid or no longer available. Review your cart.' },
  options: { text: 'Some selected add-ons are not priced for ordering yet. Remove them or ask staff.' },
  invalid: { text: 'We could not validate this order request. Please try again.' },
  unavailable: { text: 'We could not send this order right now. Please ask staff before trying again.' },
  preview: { text: 'This demo checkout cannot submit an order or take payment.' },
  placed: { text: 'Order sent to the restaurant. Please pay at the counter; no online payment was taken.', success: true },
};

/** Option A — editorial checkout. The database remains the trusted price source. */
export function Checkout({
  submitEnabled = false,
  requestId,
  status,
}: {
  submitEnabled?: boolean;
  requestId: string;
  status?: string;
}) {
  const cart = useCart();
  const totals = cart.totals;
  const hasTax = cart.taxRateBps > 0;
  const hasUnpricedAddons = cart.lines.some((line) => (line.addons?.length ?? 0) > 0);
  const notice = status ? STATUS_MESSAGES[status] : undefined;
  const orderLines = cart.lines.map((line) => ({
    item_id: line.id,
    qty: line.qty,
    ...(line.variantId ? { variant_id: line.variantId } : {}),
    ...(line.addons?.length ? { addons: line.addons } : {}),
  }));

  useEffect(() => {
    if (status === 'placed') cart.clear();
  }, [status, cart.clear]);

  if (status === 'placed') {
    return (
      <main className="co">
        <section className="qr-verify__card" role="status">
          <h1>Order received</h1>
          <p className="qr-verify__intro">{STATUS_MESSAGES.placed.text}</p>
          <Link className="qr-verify__back" href={`/menu?s=${encodeURIComponent(cart.scope)}`}>Back to menu</Link>
        </section>
      </main>
    );
  }

  return (
    <div className="co">
      <header className="co__head">
        <Link href={`/menu/cart?s=${encodeURIComponent(cart.scope)}`} className="co__back">
          ← Back to cart
        </Link>
        <h1>Checkout</h1>
        <p>{submitEnabled ? `Review your order · ${cart.count} items` : `Demo checkout · ${cart.count} items`}</p>
      </header>

      {notice && <p className={`co__note ${notice.success ? 'is-success' : ''}`} role={notice.success ? 'status' : 'alert'}>{notice.text}</p>}

      <div className="co__grid">
        <div>
          <h2 className="co__h2">Payment</h2>
          <div className="co__note">
            <strong>Pay at the counter.</strong> Online payment is not connected, so no payment is taken here.
          </div>

          <h2 className="co__h2">Order summary</h2>
          <ul className="co__items">
            {cart.lines.map((line) => (
              <li key={line.key}>
                <VegMark veg={line.veg} />
                <span>
                  <strong>{line.qty} ×</strong> {line.name}
                  {line.variant && <small className="co__fine"> · {line.variant}</small>}
                </span>
                <span className="tnum">{inr(paiseToRupees(lineTotal(line.unitPricePaise, line.qty)))}</span>
              </li>
            ))}
            {cart.lines.length === 0 && <li>Your cart is empty.</li>}
          </ul>
        </div>

        <aside className="co__sum">
          <h2>Bill</h2>
          <div className="co__row">
            <span>Subtotal</span>
            <span className="tnum">{inr(paiseToRupees(totals.subtotalPaise))}</span>
          </div>
          {hasTax && (
            <div className="co__row">
              <span>GST ({formatTaxRatePercent(cart.taxRateBps)}%)</span>
              <span className="tnum">{inr(paiseToRupees(totals.taxPaise))}</span>
            </div>
          )}
          <div className="co__row co__row--total">
            <span>Total payable</span>
            <span className="tnum">{inr(paiseToRupees(totals.totalPaise))}</span>
          </div>
          {cart.lines.length === 0 ? (
            <Link className="co__cta" href={`/menu?s=${encodeURIComponent(cart.scope)}`}>Return to the menu</Link>
          ) : submitEnabled ? (
            <form action={placeGuestOrderAction}>
              <input type="hidden" name="request_id" value={requestId} />
              <input type="hidden" name="items" value={JSON.stringify(orderLines)} />
              <OrderSubmitButton disabled={hasUnpricedAddons} totalPaise={totals.totalPaise} />
              {hasUnpricedAddons && <p className="co__fine" role="note">Some selected extras are not priced for guest ordering yet. Please ask staff.</p>}
            </form>
          ) : (
            <button className="co__cta" type="button" disabled>
              Preview only — order submission unavailable
            </button>
          )}
          <p className="co__fine" role="note">
            {submitEnabled
              ? `The restaurant database rechecks the table session, availability, menu prices and current configured tax rate before saving your order. ${hasTax ? 'The restaurant owner should verify that rate for their tax treatment.' : 'No tax is currently configured by this venue.'}`
              : `Preview only. No order is submitted and no charge is made. ${hasTax ? 'The displayed tax rate is owner-configured and must be verified before live billing.' : 'No tax is added by default.'}`}
          </p>
        </aside>
      </div>
    </div>
  );
}
