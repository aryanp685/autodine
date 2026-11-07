'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { checkoutSessionAction } from '@/app/(staff)/dashboard/actions';
import { formatBillMoney } from '@/lib/bill';
import { btn } from '@/components/owner/chrome';

export function CloseSessionButton({
  sessionId,
  table,
  outstandingPaise,
}: {
  sessionId: string;
  table: string;
  outstandingPaise: number;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  function checkout() {
    if (inFlight.current) return;
    if (!confirm) {
      setConfirm(true);
      setError('');
      return;
    }
    inFlight.current = true;
    setError('');
    startTransition(async () => {
      const result = await checkoutSessionAction(sessionId);
      inFlight.current = false;
      if (!result.ok) {
        setError(result.error);
        setConfirm(false);
        return;
      }
      router.push(result.invoiceUrl);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {confirm ? (
        <div role="group" aria-label={`Confirm checkout for ${table}`} className="max-w-[260px] rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-3 py-2 text-right">
          <p className="text-[11.5px] leading-[1.45] text-gink-64">
            Close {table} and issue the final receipt?
            {outstandingPaise > 0
              ? ` It will show ${formatBillMoney(outstandingPaise)} due; later payment will get a separate receipt.`
              : ' The receipt snapshots all tickets and payments.'}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={btn('quiet', 'sm')} onClick={() => setConfirm(false)} disabled={pending}>Keep open</button>
            <button type="button" className={btn('primary', 'sm')} onClick={checkout} disabled={pending}>
              {pending ? 'Closing…' : 'Close & issue'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={btn('ghost', 'sm')}
          onClick={checkout}
          disabled={pending}
          aria-label={`Close ${table} and issue final receipt`}
          data-checkout-session={sessionId}
        >
          Close & invoice
        </button>
      )}
      {error ? <span role="alert" className="max-w-[260px] text-right text-[10.5px] text-[var(--p-due)]">{error}</span> : null}
    </div>
  );
}
