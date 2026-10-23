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
import { btn, inputClass, Field } from '@/components/owner/chrome';
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

  /**
   * The number, as far as the button is concerned.
   *
   * toWhatsAppNumber() is the rule that matters -- it builds the link -- but
   * the button used to be live with nothing typed, so the only way to learn
   * what it wanted was to press it and read an error. Disabling it until a
   * plausible number is in the field makes the requirement visible before it
   * is a mistake.
   */
  const phoneReady = Boolean(toWhatsAppNumber(phone));

  return (
    <div className="min-h-dvh bg-paper-deep text-gink antialiased">
      {/* ---------------------------------------------------- screen toolbar
          Print chrome. `print:hidden` is the whole of the rule that keeps a
          bill a bill on paper -- see the test that pins these two nodes. */}
      <div
        data-print-chrome="toolbar"
        className="sticky top-0 z-10 border-b border-hair bg-paper/92 backdrop-blur-xl print:hidden"
      >
        <div className="mx-auto flex w-full max-w-[720px] items-center justify-between gap-3 px-5 py-3">
          <Link href="/cashier" className={`${btn('quiet', 'sm')} -ml-2`}>
            ← Counter
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-[11.5px] text-gink-46 sm:inline">
              One page, nothing else
            </span>
            <PrintButton className={btn('solid', 'sm')}>Print bill</PrintButton>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[720px] px-5 py-6 sm:py-8">
        {/* The sheet. On paper it is the only thing left, so it carries the
            whole document: no card, no shadow, no page furniture. */}
        <article
          data-bill-sheet
          className="rounded-[14px] border border-hair bg-card px-6 py-7 sm:px-9 sm:py-9 print:rounded-none print:border-0 print:px-0 print:py-0"
        >
          <header className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <h1 className="text-[22px] leading-[1.2] font-medium tracking-[-0.03em] text-gink">
                {restaurant.name}
              </h1>
              {restaurant.address ? (
                <p className="mt-1.5 max-w-[34ch] text-[12px] leading-[1.5] text-gink-46">
                  {restaurant.address}
                </p>
              ) : null}
              {restaurant.phone ? (
                <p className="mt-0.5 text-[12px] text-gink-46">Phone {restaurant.phone}</p>
              ) : null}
              {restaurant.gstin ? (
                <p className="mt-0.5 text-[12px] text-gink-46">GSTIN {restaurant.gstin}</p>
              ) : null}
            </div>

            <div className="text-right">
              <div className="text-[10.5px] font-semibold tracking-[0.11em] text-gink-46 uppercase">
                Bill
              </div>
              <div className="mt-1 text-[15px] font-medium tracking-[-0.01em] text-gink tabular-nums">
                {order.code}
              </div>
              <p className="mt-1 text-[12px] text-gink-46">{order.placedAt}</p>
              <p className="text-[12px] text-gink-46">{order.tableLabel ?? 'Takeaway'}</p>
            </div>
          </header>

          {order.cancelled ? (
            <p className="mt-5 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[11.5px] font-semibold tracking-[0.04em] text-[var(--alert)] uppercase">
              CANCELLED — nothing is chargeable on this bill
            </p>
          ) : null}

          <table className="mt-6 w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b border-hair pb-2 text-left text-[10px] font-semibold tracking-[0.09em] text-gink-46 uppercase"
                >
                  Qty
                </th>
                <th
                  scope="col"
                  className="border-b border-hair pb-2 text-left text-[10px] font-semibold tracking-[0.09em] text-gink-46 uppercase"
                >
                  Item
                </th>
                <th
                  scope="col"
                  className="border-b border-hair pb-2 text-right text-[10px] font-semibold tracking-[0.09em] text-gink-46 uppercase"
                >
                  Rate
                </th>
                <th
                  scope="col"
                  className="border-b border-hair pb-2 text-right text-[10px] font-semibold tracking-[0.09em] text-gink-46 uppercase"
                >
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="border-b border-hair py-2.5 align-top tabular-nums text-gink-64">
                    {line.qty}
                  </td>
                  <td className="border-b border-hair py-2.5 align-top text-gink">
                    <span className="flex items-start gap-1.5">
                      <span className="mt-[3px]">
                        <VegMark veg={line.isVeg} size={10} />
                      </span>
                      <span>{line.label}</span>
                    </span>
                  </td>
                  <td className="border-b border-hair py-2.5 text-right align-top tabular-nums text-gink-64">
                    {formatBillMoney(line.ratePaise)}
                  </td>
                  <td className="border-b border-hair py-2.5 text-right align-top tabular-nums text-gink">
                    {formatBillMoney(line.amountPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {order.customerNote ? (
            <p className="mt-4 rounded-[10px] bg-paper-deep px-3.5 py-2.5 text-[12px] leading-[1.5] text-gink-64">
              <span className="font-medium text-gink">Note for the kitchen:</span>{' '}
              {order.customerNote}
            </p>
          ) : null}

          {/* Totals sit right, on one edge, so the eye can add them up. */}
          <div className="mt-5 ml-auto w-full max-w-[300px] text-[12.5px]">
            <Row label="Subtotal" value={formatBillMoney(order.subtotalPaise)} />

            {order.discountPaise > 0 ? (
              <Row label="Discount" value={`−${formatBillMoney(order.discountPaise)}`} />
            ) : null}

            {tax ? (
              <>
                <Row label={`CGST${taxSuffix}`} value={formatBillMoney(tax.cgstPaise)} />
                <Row label={`SGST${taxSuffix}`} value={formatBillMoney(tax.sgstPaise)} />
              </>
            ) : null}

            <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-gink py-2.5">
              <span className="text-[12.5px] font-semibold tracking-[0.01em] text-gink uppercase">
                Total
              </span>
              <span className="text-[16px] font-medium tracking-[-0.02em] text-gink tabular-nums">
                {formatBillMoney(order.totalPaise)}
              </span>
            </div>

            {paid > 0 && bill.outstandingPaise > 0 ? (
              <Row label="Paid so far" value={formatBillMoney(paid)} />
            ) : null}
          </div>

          <footer className="mt-7 border-t border-hair pt-4">
            <p className="text-[12px] leading-[1.55] text-gink-64">{paymentLine}</p>
            {payments.length > 0 && !order.cancelled ? (
              <p className="mt-1 text-[11.5px] leading-[1.5] text-gink-46">
                {payments
                  .map(
                    (p) =>
                      `${paymentMethodLabel(p.method)} · ${formatBillMoney(p.amountPaise)} · ${p.at}`,
                  )
                  .join('  ·  ')}
              </p>
            ) : null}
            <p className="mt-3 text-[12px] text-gink-46">Thank you.</p>
          </footer>
        </article>

        {/* -------------------------------------------------- WhatsApp panel */}
        <section
          data-print-chrome="whatsapp"
          aria-labelledby="bill-wa-title"
          className="mt-5 rounded-[14px] border border-hair bg-card px-5 py-5 print:hidden"
        >
          <h2 id="bill-wa-title" className="text-[13px] font-semibold text-gink">
            Send this bill on WhatsApp
          </h2>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Guest's mobile number" htmlFor="bill-wa-phone" className="flex-1">
              <input
                id="bill-wa-phone"
                data-bill-wa-phone
                className={inputClass}
                inputMode="tel"
                autoComplete="off"
                placeholder="98765 43210"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setError('');
                }}
              />
            </Field>
            <button
              type="button"
              data-bill-wa-button
              className={btn('solid')}
              onClick={sendOnWhatsApp}
              disabled={!phoneReady}
            >
              Open WhatsApp
            </button>
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-[11.5px] leading-[1.5] text-[var(--alert)]">
              {error}
            </p>
          ) : null}

          {/* The hand-off sentence is always here; the reason the button is
              asleep is only worth saying while it is asleep. */}
          <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
            Opens WhatsApp with this bill written out — you still press send yourself. No payment
            provider is involved, and the number is not saved by AutoDine.
          </p>
          {!phoneReady ? (
            <p className="mt-1 text-[11.5px] leading-[1.5] text-gink-46">
              Type the guest’s 10-digit mobile number to enable this.
            </p>
          ) : null}

          {missingDetails ? (
            <p className="mt-2 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-gink-64">
              Address or GSTIN is empty, so printed bills go out without them.{' '}
              <Link
                href="/dashboard/settings"
                className="font-medium text-gink underline decoration-hair-strong underline-offset-2"
              >
                Add them in Settings
              </Link>
              .
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}

/** One line of the totals block: label left, figure right, hairline under. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hair py-2 last:border-b-0">
      <span className="text-gink-64">{label}</span>
      <span className="tabular-nums text-gink">{value}</span>
    </div>
  );
}
