'use client';

import { useRef, useState, useTransition } from 'react';
import { markSessionPaidAction } from '@/app/(staff)/dashboard/actions';
import { COUNTER_METHODS, COUNTER_METHOD_LABEL, type CounterMethod } from '@/lib/payment-methods';

/**
 * Settlement control for the table's consolidated sitting. The staff member
 * first states how the guest actually paid — cash, card or UPI — so the
 * ledger, the sales analysis and the bill carry the real method instead of a
 * generic manual marker. UPI asks for the transaction reference, matching the
 * cashier screen's contract.
 */
export function MarkSessionPaidButton({ sessionId, table }: { sessionId: string; table: string }) {
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<CounterMethod | null>(null);
  const [upiRef, setUpiRef] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  const upiReady = method !== 'upi' || upiRef.trim() !== '';
  const canSubmit = method !== null && upiReady && !pending;

  function markPaid() {
    if (inFlight.current || !method || !upiReady) return;
    inFlight.current = true;
    setMessage('');
    setError('');

    startTransition(async () => {
      const result = await markSessionPaidAction(sessionId, method, upiRef);
      if (result.ok) {
        setMessage(`Marked paid (${COUNTER_METHOD_LABEL[method]}).`);
      } else {
        setError(result.error);
      }
      inFlight.current = false;
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div role="radiogroup" aria-label={`How did the ${table} guest pay?`} className="flex gap-1">
        {COUNTER_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            data-mark-method={m}
            onClick={() => setMethod(method === m ? null : m)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              method === m ? 'bg-ink text-surface' : 'bg-black/[0.06] text-ink/70'
            }`}
          >
            {COUNTER_METHOD_LABEL[m]}
          </button>
        ))}
      </div>
      {method === 'upi' && (
        <input
          type="text"
          value={upiRef}
          onChange={(event) => setUpiRef(event.target.value)}
          placeholder="UPI transaction reference (TRN)"
          aria-label="UPI transaction reference"
          data-mark-upi-ref
          className="w-full rounded-lg border border-black/10 px-2 py-1 text-xs"
        />
      )}
      <button
        type="button"
        onClick={markPaid}
        disabled={!canSubmit}
        aria-label={`Mark ${table} paid`}
        data-mark-session-paid={sessionId}
        className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
      >
        {pending ? 'Saving…' : '✓ Mark paid'}
      </button>
      {message && (
        <p role="status" data-mark-paid-status={message} className="text-[11px] text-emerald-700">{message}</p>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-red-700">{error}</p>
      )}
    </div>
  );
}
