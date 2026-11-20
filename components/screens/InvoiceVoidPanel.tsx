'use client';
import { useRouter } from 'next/navigation';
import { useState,useTransition } from 'react';
import { btn,inputClass } from '@/components/owner/chrome';
import { voidBillingDocumentAction } from '@/app/invoice/[id]/void-action';

export function InvoiceVoidPanel({ id }: { id: string }) {
  const [message,setMessage] = useState('');
  const [reason,setReason] = useState('');
  const [pending,startTransition] = useTransition();
  const router = useRouter();
  return <details className="mx-auto mt-4 max-w-[760px] rounded-[14px] border border-hair bg-card p-4 print:hidden">
    <summary className="cursor-pointer text-[13px] font-medium">Void this document</summary>
    <p className="mt-2 text-[12.5px] text-gink-64">Only for a documented local correction. The original number and amounts will remain in history. This does not cancel an IRN, reduce filed tax, or refund payment.</p>
    <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); setMessage(''); startTransition(async () => {
      try {
        const result = await voidBillingDocumentAction(id,reason);
        if (result.ok) router.refresh(); else setMessage(result.error);
      } catch { setMessage('Reload to verify the document status before retrying.'); }
    }); }}>
      <label className="text-xs">Reason for void<textarea className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required disabled={pending} /></label>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" required disabled={pending} /> Confirm local void of the saved document.</label>
      <div><button type="submit" className={btn('ghost','sm')} disabled={pending}>{pending ? 'Recording…' : 'Confirm void'}</button></div>
      {message ? <p role="alert" className="text-[12.5px] text-[var(--p-due)]">{message}</p> : null}
    </form>
  </details>;
}
