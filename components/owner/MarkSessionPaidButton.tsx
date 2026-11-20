'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markSessionPaidAction } from '@/app/(staff)/dashboard/actions';
import { btn } from '@/components/owner/chrome';

/** One-tap, no-method settlement for the table's consolidated sitting. */
export function MarkSessionPaidButton({
  sessionId,
  table,
}: {
  sessionId: string;
  table: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  function markPaid() {
    if (inFlight.current) return;
    if (!confirm) { setConfirm(true); return; }
    inFlight.current = true;
    setMessage('');
    setError('');

    startTransition(async () => {
      try {
        const result = await markSessionPaidAction(sessionId);
        if (!result.ok) { setError(result.error); return; }
        setMessage(`${table} marked paid.`);
      } catch {
        setError('Payment could not be verified. Check the ledger before recording it again.');
      } finally {
        inFlight.current = false;
        setConfirm(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {confirm && <p className="max-w-[270px] text-[11.5px] text-gink-64">
        Confirm you have received the full outstanding balance for {table}. This records manual settlement, not cash, card or UPI. Use the counter for a specific tender.
      </p>}
      <button
        type="button"
        className={btn('primary', 'sm')}
        onClick={markPaid}
        disabled={pending}
        aria-label={confirm ? `Confirm manual settlement for ${table}` : `Mark ${table} paid`}
        data-mark-session-paid={sessionId}
      >
        {pending ? 'Saving…' : confirm ? 'Confirm manual settlement' : '✓ Mark paid'}
      </button>
      {confirm && <button type="button" className={btn('quiet', 'sm')} disabled={pending} onClick={() => setConfirm(false)}>Keep unpaid</button>}
      {message ? <span role="status" className="text-[10.5px] text-gink-46">{message}</span> : null}
      {error ? <span role="alert" className="text-[10.5px] text-[var(--p-due)]">{error}</span> : null}
    </div>
  );
}
