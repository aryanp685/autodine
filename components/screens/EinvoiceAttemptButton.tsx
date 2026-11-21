'use client';

/**
 * "Attempt e-Invoice" for documents recorded as IRP pending/failed.
 *
 * Owner/manager only (the server action re-checks). The attempt is recorded
 * in the e-Invoice audit table; no provider is contacted unless this
 * deployment was deliberately configured with one — today that means the
 * offline sandbox, which is not an IRP and never files anything.
 */

import { useState, useTransition } from 'react';

import { attemptEinvoiceAction, type EinvoiceAttemptResult } from '@/app/invoice/[id]/einvoice-actions';
import { btn } from '@/components/owner/chrome';

export function EinvoiceAttemptButton({ invoiceId, irpStatus }: { invoiceId: string; irpStatus: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<EinvoiceAttemptResult | null>(null);

  if (irpStatus !== 'pending' && irpStatus !== 'failed') return null;

  function attempt() {
    setResult(null);
    startTransition(async () => {
      setResult(await attemptEinvoiceAction(invoiceId));
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
        title="Build the IRP payload, record the attempt, and submit it to the configured provider (offline sandbox unless e-invoicing is enabled)."
      >
        {pending ? 'Attempting…' : 'Attempt e-Invoice'}
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
