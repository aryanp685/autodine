'use client';

/**
 * e-Invoice IRP controls for regular GST tax invoices:
 * - "Attempt e-Invoice" / "Retry e-Invoice" when IRP status is pending or failed
 * - "Cancel IRN (24h)" when IRP status is generated (owner/manager only)
 */

import { useState, useTransition } from 'react';

import {
  attemptEinvoiceAction,
  cancelEinvoiceAction,
  type EinvoiceAttemptResult,
  type EinvoiceCancelResult,
} from '@/app/invoice/[id]/einvoice-actions';
import { btn } from '@/components/owner/chrome';
import { IRP_CANCEL_REASONS, type IrpCancelReason } from '@/lib/gst/irp/types';

export function EinvoiceAttemptButton({
  invoiceId,
  irpStatus,
}: {
  invoiceId: string;
  irpStatus: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<EinvoiceAttemptResult | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<IrpCancelReason>('2');
  const [remark, setRemark] = useState('');
  const [cancelResult, setCancelResult] = useState<EinvoiceCancelResult | null>(null);

  if (irpStatus === 'generated') {
    function handleCancel() {
      setCancelResult(null);
      startTransition(async () => {
        const res = await cancelEinvoiceAction({ invoiceId, reasonCode, remark });
        setCancelResult(res);
        if (res.ok && typeof window !== 'undefined') {
          setCancelOpen(false);
          window.location.reload();
        }
      });
    }

    return (
      <span className="inline-flex max-w-[360px] flex-col items-end gap-1.5">
        <button
          type="button"
          className={btn('ghost', 'sm')}
          onClick={() => setCancelOpen((prev) => !prev)}
          disabled={pending}
        >
          Cancel IRN (24h)
        </button>
        {cancelOpen ? (
          <div className="flex flex-col gap-1.5 rounded border border-hair bg-card p-2.5 text-left text-[11.5px]">
            <select
              aria-label="IRP cancel reason"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as IrpCancelReason)}
              className="rounded border border-hair bg-paper px-2 py-1 text-gink"
            >
              {(Object.entries(IRP_CANCEL_REASONS) as Array<[IrpCancelReason, string]>).map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="IRP cancel remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Reason (3–100 chars)"
              maxLength={100}
              className="rounded border border-hair bg-paper px-2 py-1 text-gink"
            />
            <button
              type="button"
              className={btn('danger', 'sm')}
              disabled={pending || remark.trim().length < 3}
              onClick={handleCancel}
            >
              {pending ? 'Cancelling…' : 'Confirm IRN cancellation'}
            </button>
          </div>
        ) : null}
        {cancelResult ? (
          <span
            role="status"
            aria-live="polite"
            className={`text-right text-[10.5px] leading-[1.45] ${cancelResult.ok ? 'text-gink-64' : 'text-[var(--p-due)]'}`}
          >
            {cancelResult.ok ? cancelResult.message : cancelResult.error}
          </span>
        ) : null}
      </span>
    );
  }

  if (irpStatus !== 'pending' && irpStatus !== 'failed') return null;

  function attempt() {
    setResult(null);
    startTransition(async () => {
      const res = await attemptEinvoiceAction(invoiceId);
      setResult(res);
      if (res.ok && res.outcome === 'accepted' && typeof window !== 'undefined') {
        window.location.reload();
      }
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
        title="Build the IRP payload, record the attempt, and submit it to the configured IRP provider."
      >
        {pending ? 'Submitting…' : irpStatus === 'failed' ? 'Retry e-Invoice' : 'Attempt e-Invoice'}
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
