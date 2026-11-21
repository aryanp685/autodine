'use client';

import { useRef, useState, useTransition } from 'react';
import { callWaiterAction } from '@/app/menu/waiter-actions';

function requestKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 0x1_0000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${((8 + Math.floor(Math.random() * 4)).toString(16))}${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

/** A verified table guest can raise one durable, idempotent staff request. */
export function CallWaiterButton() {
  const [pending, startTransition] = useTransition();
  const [called, setCalled] = useState(false);
  const [message, setMessage] = useState('');
  const requestKeyRef = useRef('');

  const call = () => {
    if (pending || called) return;
    requestKeyRef.current ||= requestKey();
    setMessage('');
    startTransition(async () => {
      const result = await callWaiterAction(requestKeyRef.current);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setCalled(true);
      setMessage(
        result.state === 'already_open'
          ? 'A staff member has already been called for this table.'
          : result.state === 'already_handled'
            ? 'This request was already handled.'
            : 'A staff member has been called. Please wait at your table.',
      );
    });
  };

  return (
    <div data-call-waiter="" className="mt-3">
      <button
        type="button"
        onClick={call}
        disabled={pending || called}
        aria-busy={pending || undefined}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-hair bg-card px-4 py-2 text-[13px] font-semibold text-gink transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-65"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M4 12h3l2-6 4 12 2-6h5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {pending ? 'Calling…' : called ? 'Waiter called' : 'Call a waiter'}
      </button>
      {message ? <p role="status" className="mt-2 text-[12.5px] leading-[1.45] text-gink-64">{message}</p> : null}
    </div>
  );
}
