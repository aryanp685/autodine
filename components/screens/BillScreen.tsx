'use client';

/**
 * The bill, as it is handed to a guest.
 *
 * Two jobs, and they are different media:
 *
 *   on screen  a staff member checking it before printing, and a field for the
 *              guest's number so it can be sent on WhatsApp
 *   on paper   only the bill itself -- see the @media print block, which hides
 *              the toolbar and the WhatsApp panel
 *
 * Everything printed here comes from the order's stored figures. The screen
 * does not recompute a total, because a bill that disagrees with what was
 * charged is worse than no bill at all.
 */

import Link from 'next/link';
import { useState } from 'react';

import { PrintButton } from '@/components/PrintButton';
import { VegMark } from '@/components/ui';
import {
  billTaxSplit,
  buildBillMessage,
  formatBillMoney,
  paymentMethodLabel,
  toWhatsAppNumber,
  whatsAppLink,
  type BillData,
} from '@/lib/bill';

export function BillScreen({ bill }: { bill: BillData }) {
  const { order, restaurant, lines, payments } = bill;
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const tax = billTaxSplit(order.taxPaise, order.taxRateBps);
  const taxSuffix = order.taxRateBps == null ? '' : ` ${tax?.rateLabel ?? ''}`;
  const paid = payments.reduce((sum, p) => sum + p.amountPaise, 0);

  const paymentLine = order.cancelled
    ? 'This order was cancelled. Nothing is payable.'
    : bill.outstandingPaise > 0
      ? `Balance due: ${formatBillMoney(bill.outstandingPaise)} — please pay at the counter.`
      : payments.length > 0
        ? `Paid by ${paymentMethodLabel(payments[payments.length - 1].method)} at the counter.`
        : 'Not paid yet — please pay at the counter.';

  const message = buildBillMessage({
    restaurantName: restaurant.name,
    code: order.code,
    placedAt: order.placedAt,
    tableLabel: order.tableLabel,
    lines: lines.map((l) => ({ label: l.label, qty: l.qty, amountPaise: l.amountPaise })),
    subtotalPaise: order.subtotalPaise,
    discountPaise: order.discountPaise,
    taxPaise: order.taxPaise,
    taxRateBps: order.taxRateBps,
    totalPaise: order.totalPaise,
    paymentLine,
  });

  function sendOnWhatsApp() {
    const number = toWhatsAppNumber(phone);
    if (!number) {
      setError('Enter a 10-digit Indian mobile number, or one with +91 in front.');
      return;
    }

    setError('');
    // A new tab, so the bill page stays open on the counter screen. wa.me
    // opens WhatsApp with the message written; the staff member still presses
    // send. Nothing leaves this device until they do.
    window.open(whatsAppLink(number, message), '_blank', 'noopener,noreferrer');
  }

  const missingDetails = !restaurant.address || !restaurant.gstin;

  return (
    <div className="bill">
      <div className="bill__bar">
        <Link href="/cashier" className="bill__back">
          ← Counter
        </Link>
        <div className="bill__barActions">
          <PrintButton className="pg__btn">Print bill</PrintButton>
        </div>
      </div>

      <article className="bill__sheet">
        <header className="bill__head">
          <div className="bill__brand">
            <h1 className="bill__name">{restaurant.name}</h1>
            {restaurant.address ? <p className="bill__meta">{restaurant.address}</p> : null}
            {restaurant.phone ? <p className="bill__meta">Phone {restaurant.phone}</p> : null}
            {restaurant.gstin ? <p className="bill__meta">GSTIN {restaurant.gstin}</p> : null}
          </div>

          <div className="bill__ref">
            <div className="bill__kicker">Bill</div>
            <div className="bill__code">{order.code}</div>
            <p className="bill__meta">{order.placedAt}</p>
            <p className="bill__meta">{order.tableLabel ?? 'Takeaway'}</p>
          </div>
        </header>

        {order.cancelled ? (
          <p className="bill__void">CANCELLED — nothing is chargeable on this bill</p>
        ) : null}

        <table className="bill__table">
          <thead>
            <tr>
              <th scope="col">Qty</th>
              <th scope="col">Item</th>
              <th scope="col" className="bill__num">
                Rate
              </th>
              <th scope="col" className="bill__num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>{line.qty}</td>
                <td>
                  <span className="bill__item">
                    <VegMark veg={line.isVeg} size={11} />
                    {line.label}
                  </span>
                </td>
                <td className="bill__num">{formatBillMoney(line.ratePaise)}</td>
                <td className="bill__num">{formatBillMoney(line.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {order.customerNote ? (
          <p className="bill__note">Note for the kitchen: {order.customerNote}</p>
        ) : null}

        <div className="bill__totals">
          <div className="bill__row">
            <span>Subtotal</span>
            <span className="tnum">{formatBillMoney(order.subtotalPaise)}</span>
          </div>

          {order.discountPaise > 0 ? (
            <div className="bill__row">
              <span>Discount</span>
              <span className="tnum">−{formatBillMoney(order.discountPaise)}</span>
            </div>
          ) : null}

          {tax ? (
            <>
              <div className="bill__row">
                <span>CGST{taxSuffix}</span>
                <span className="tnum">{formatBillMoney(tax.cgstPaise)}</span>
              </div>
              <div className="bill__row">
                <span>SGST{taxSuffix}</span>
                <span className="tnum">{formatBillMoney(tax.sgstPaise)}</span>
              </div>
            </>
          ) : null}

          <div className="bill__row bill__row--total">
            <span>Total</span>
            <span className="tnum">{formatBillMoney(order.totalPaise)}</span>
          </div>

          {paid > 0 && bill.outstandingPaise > 0 ? (
            <div className="bill__row">
              <span>Paid so far</span>
              <span className="tnum">{formatBillMoney(paid)}</span>
            </div>
          ) : null}
        </div>

        <footer className="bill__foot">
          <p className="bill__meta">{paymentLine}</p>
          {payments.length > 0 && !order.cancelled ? (
            <p className="bill__meta">
              {payments
                .map((p) => `${paymentMethodLabel(p.method)} · ${formatBillMoney(p.amountPaise)} · ${p.at}`)
                .join('  ·  ')}
            </p>
          ) : null}
          <p className="bill__thanks">Thank you.</p>
        </footer>
      </article>

      <section className="bill__wa" aria-labelledby="bill-wa-title">
        <h2 className="bill__waTitle" id="bill-wa-title">
          Send this bill on WhatsApp
        </h2>

        <div className="bill__waForm">
          <label className="ui-field">
            <span className="ui-label">Guest&apos;s mobile number</span>
            <input
              className="ui-input"
              inputMode="tel"
              autoComplete="off"
              placeholder="98765 43210"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setError('');
              }}
            />
          </label>
          <button type="button" className="pg__btn" onClick={sendOnWhatsApp}>
            Open WhatsApp
          </button>
        </div>

        {error ? (
          <p className="bill__error" role="alert">
            {error}
          </p>
        ) : null}

        <p className="bill__hint">
          Opens WhatsApp with this bill written out — you still press send yourself. No payment
          provider is involved, and the number is not saved by AutoDine.
        </p>

        {missingDetails ? (
          <p className="bill__hint bill__hint--warn">
            Address or GSTIN is empty, so printed bills go out without them.{' '}
            <Link href="/dashboard/settings">Add them in Settings</Link>.
          </p>
        ) : null}
      </section>
    </div>
  );
}
