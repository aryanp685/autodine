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
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  function markPaid() {
    if (inFlight.current) return;
    inFlight.current = true;
    setMessage('');
    setError('');

    startTransition(async () => {
      const result = await markSessionPaidAction(sessionId);
      inFlight.current = false;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`${table} marked paid.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        className={btn('primary', 'sm')}
        onClick={markPaid}
        disabled={pending}
        aria-label={`Mark ${table} paid`}
        data-mark-session-paid={sessionId}
      >
        {pending ? 'Saving…' : '✓ Mark paid'}
      </button>
      {message ? <span role="status" className="text-[10.5px] text-gink-46">{message}</span> : null}
      {error ? <span role="alert" className="text-[10.5px] text-[var(--p-due)]">{error}</span> : null}
    </div>
  );
}
