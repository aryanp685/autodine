'use client';

/**
 * The restaurant's own UPI QR, on the guest's phone.
 *
 * WHAT THIS IS
 *
 * The shop's existing UPI standee, with the amount filled in and the payee
 * named. No gateway, no card number, nothing the restaurant has not already
 * printed and taped to its counter.
 *
 * WHAT THIS IS NOT
 *
 * A payment. Displaying a QR proves nothing: the money moves inside the guest's
 * UPI app and that app tells the guest, not us. So:
 *
 *   - the order stays PENDING after "I have paid" — a claim, not a receipt;
 *   - the screen says, in those words, that staff confirm it;
 *   - the amount is read from the database (public_upi_details), never from
 *     this component, so a browser editing the number changes only what the
 *     guest sees, not what is owed.
 *
 * WHY THE QR IS SERVER-RENDERED SVG
 *
 * Same reason as the table cards: no client encoder in the bundle, sharp on a
 * phone at arm's length, and it cannot fail at the moment somebody is trying to
 * leave. The `upi://` link underneath is offered too — on iOS and Android it
 * opens the guest's own app with the payee and amount pre-filled, which is two
 * taps instead of a camera.
 */

import { useState } from 'react';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import { claimUpiPaymentAction } from '@/app/menu/order/actions';
import type { UpiPayment } from '@/lib/db/order-screen';

export function PayUpi({
  upi,
  slug,
  code,
  token,
}: {
  upi: UpiPayment;
  slug: string;
  code: string;
  token: string;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'claimed' | 'error'>(
    upi.claimedAt ? 'claimed' : 'idle'
  );
  const [error, setError] = useState('');

  const claimed = state === 'claimed';

  async function claim() {
    if (state === 'sending' || claimed) return;
    setState('sending');
    setError('');

    const result = await claimUpiPaymentAction({ slug, code, token });

    if (result.ok) {
      setState('claimed');
      return;
    }
    setError(result.error);
    setState('error');
  }

  return (
    <div
      data-pay-upi
      className="mt-4 overflow-hidden rounded-2xl border border-hair-strong bg-paper-deep/60"
    >
      <div className="flex items-start gap-4 px-4 py-4">
        <div
          aria-label={`UPI code for ${upi.payeeName}`}
          role="img"
          className="size-[108px] shrink-0 overflow-hidden rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-hair"
        >
          {upi.svg ? (
            <span
              data-upi-qr
              className="block [&>svg]:block [&>svg]:size-full"
              // The encoder's output, built on the server from the same string
              // as `upi.uri`. No user input reaches this string: the payee is
              // the restaurant's own row, and the amount is an integer.
              dangerouslySetInnerHTML={{ __html: upi.svg }}
            />
          ) : (
            <span className="grid size-full place-items-center text-center text-[10px] leading-tight text-gink-46">
              Code could not be drawn
            </span>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold tracking-[0.14em] text-gink-46 uppercase">
            Pay by UPI
          </p>
          <p className="mt-1 text-[15px] leading-tight font-semibold text-gink">{upi.payeeName}</p>
          <p className="mt-0.5 font-mono text-[11.5px] break-all text-gink-64">{upi.upiId}</p>
          <p className="mt-2 text-[13px] text-gink-64">
            Amount{' '}
            <strong className="tnum font-semibold text-gink">{inr(paiseToRupees(upi.duePaise))}</strong>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-hair bg-card px-4 py-3">
        <a
          href={upi.uri}
          className="inline-flex h-10 items-center rounded-full border border-hair-strong px-4 text-[13px] font-semibold text-gink transition-colors hover:bg-paper-deep"
        >
          Open UPI app
        </a>

        {claimed ? (
          <span data-upi-claimed className="text-[12px] leading-[1.5] text-gink-64">
            <strong className="font-semibold text-gink">Waiting for the counter.</strong> They check
            their own bank app before marking this paid.
          </span>
        ) : (
          <button
            type="button"
            onClick={claim}
            disabled={state === 'sending'}
            data-upi-claim
            className="inline-flex h-10 items-center rounded-full bg-gink px-4 text-[13px] font-semibold text-onink transition-opacity hover:opacity-90 disabled:opacity-55"
          >
            {state === 'sending' ? 'Telling the counter…' : 'I have paid'}
          </button>
        )}
      </div>

      {error ? (
        <p className="border-t border-[var(--alert)]/20 bg-[var(--alert)]/8 px-4 py-2.5 text-[12px] leading-[1.5] text-[var(--alert)]">
          {error} Show staff your payment confirmation.
        </p>
      ) : null}

      <p className="border-t border-hair px-4 py-2.5 text-[11.5px] leading-[1.5] text-gink-46">
        This QR belongs to the restaurant, not to AutoDine. Paying it does not mark the
        order paid — staff confirm the transfer, then record it at the counter.
      </p>
    </div>
  );
}
