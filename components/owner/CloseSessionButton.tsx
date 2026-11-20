'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { checkoutSessionAction } from '@/app/(staff)/dashboard/actions';
import { btn } from '@/components/owner/chrome';
import { GstBuyerFields } from './GstBuyerFields';
import type { CheckoutRecipient } from '@/lib/gst/buyer';

export function CloseSessionButton({
  sessionId,
  table,
  outstandingPaise,
  gstMode = 'off',
  identifiedRequired = false,
  outletId,
  canSaveBuyer,
}: {
  sessionId: string;
  table: string;
  outstandingPaise: number;
  identifiedRequired?: boolean;
  outletId?: string;
  canSaveBuyer?: boolean;
  /** 'regular' enables the optional B2B buyer block (GST tax invoice). */
  gstMode?: 'off' | 'regular' | 'composition';
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [buyerOpen, setBuyerOpen] = useState(identifiedRequired);
  const [buyer, setBuyer] = useState<CheckoutRecipient>();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  const buyerActive = gstMode === 'regular' && buyerOpen && Boolean(buyer);

  if (outstandingPaise > 0) {
    return (
      <p role="note" className="max-w-[260px] text-right text-[10.5px] leading-[1.45] text-gink-46">
        Settle the outstanding balance before closing this table.
      </p>
    );
  }

  function checkout() {
    if (inFlight.current) return;
    if (gstMode === 'regular' && (buyerOpen || identifiedRequired) && !buyer) {
      setBuyerOpen(true);
      setError(identifiedRequired ? 'Enter buyer details for this amount.' : 'Complete the buyer details, or clear them for walk-in billing.');
      return;
    }
    if (!confirm) {
      setConfirm(true);
      setError('');
      return;
    }
    inFlight.current = true;
    setError('');
    startTransition(async () => {
      try {
        const result = await checkoutSessionAction(sessionId, buyerActive ? buyer : undefined);
        if (!result.ok) { setError(result.error); setConfirm(false); return; }
        router.push(result.invoiceUrl);
      } catch {
        setError('Could not verify checkout. Reload the table before trying again.');
        setConfirm(false);
      } finally { inFlight.current = false; }
    });
  }

  const buyerBlock = gstMode === 'regular' && buyerOpen ? (
    <div hidden={confirm} className="w-full"><GstBuyerFields onChange={setBuyer} outletId={outletId} canSave={canSaveBuyer} identifiedRequired={identifiedRequired} /></div>
  ) : null;

  const buyerToggle = gstMode === 'regular' && !identifiedRequired ? (
    <button type="button" className="mb-1 text-[10px] font-medium text-gink-46 underline underline-offset-2"
      onClick={() => { setBuyerOpen(!buyerOpen); setBuyer(undefined); }} aria-expanded={buyerOpen}>
      {buyerOpen ? 'Clear buyer details' : 'Add buyer details or GSTIN'}
    </button>
  ) : null;

  const toggle = confirm ? (
    <div role="group" aria-label={`Confirm checkout for ${table}`} className="max-w-[260px] rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-3 py-2 text-right">
      <p className="text-[11.5px] leading-[1.45] text-gink-64">
        Close {table} and save the {gstMode === 'regular' ? 'GST document' : gstMode === 'composition' ? 'Bill of Supply' : 'final receipt'}? All tickets and payments are saved in the document.
        {buyerActive ? ' If IRN validation is required, the document stays on hold and cannot be shared as a tax invoice.' : null}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className={btn('quiet', 'sm')} onClick={() => setConfirm(false)} disabled={pending}>Keep open</button>
        <button type="button" className={btn('primary', 'sm')} onClick={checkout} disabled={pending}>
          {pending ? 'Closing…' : 'Close & issue'}
        </button>
      </div>
    </div>
  ) : (
    <>
      {buyerToggle}
      {gstMode === 'composition' ? <p className="text-right text-[10px] text-gink-64">For a registered buyer requesting a Bill of Supply, stop and ask the owner. This checkout cannot capture that registration.</p> : null}
      <button
        type="button"
        className={btn('ghost', 'sm')}
        onClick={checkout}
        disabled={pending}
        aria-label={`Close ${table} and ${gstMode === 'off' ? 'issue final receipt' : 'save billing document'}`}
        data-checkout-session={sessionId}
      >
        Close & invoice
      </button>
    </>
  );

  return (
    <div className="flex w-full max-w-[260px] flex-col items-end gap-1.5">
      {buyerBlock}
      {toggle}
      {error ? <span role="alert" className="max-w-[260px] text-right text-[10.5px] text-[var(--p-due)]">{error}</span> : null}
    </div>
  );
}
