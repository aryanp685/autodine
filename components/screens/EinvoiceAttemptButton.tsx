'use client';

/** Local INV-01 preparation only. No provider or IRN release. */
import { useState, useTransition } from 'react';

import { attemptEinvoiceAction, type EinvoiceAttemptResult } from '@/app/invoice/[id]/einvoice-actions';
import { btn } from '@/components/owner/chrome';

export function EinvoiceAttemptButton({ invoiceId, irpStatus, kind = 'invoice' }: { invoiceId: string; irpStatus: string; kind?: 'invoice' | 'note' }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<EinvoiceAttemptResult | null>(null);

  if (irpStatus !== 'pending' && irpStatus !== 'failed') return null;

  function attempt() {
    setResult(null);
    startTransition(async () => {
      setResult(await attemptEinvoiceAction(invoiceId, kind));
    });
  }

  return (
    <span className="inline-flex max-w-[320px] flex-col items-end gap-1">
      <button
        type="button"
        className={btn('ghost', 'sm')}
        onClick={attempt}
        disabled={pending}
        data-einvoice-attempt={invoiceId}
        title="Validate and record the INV-01 payload offline. No submission."
      >
        {pending ? 'Validating…' : 'Validate IRP payload offline'}
      </button>
      {result ? (
        <span
          role="status"
          aria-live="polite"
          className={`text-right text-[10.5px] leading-[1.45] ${result.ok ? 'text-gink-64' : 'text-[var(--p-due)]'}`}
        >
          {result.ok ? result.message : result.error}
        </span>
      ) : null}
    </span>
  );
}
