'use client';

import { useActionState, useState } from 'react';
import { placeDirectTicketAction } from '@/app/(staff)/dashboard/direct-order/actions';
import { GST_OUTLET_STATES } from '@/lib/gst/onboarding';
import { btn, Field, inputClass, Panel } from '@/components/owner/chrome';
import type { MenuItem } from '@/lib/db/types';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { formatBillMoney } from '@/lib/bill';

export function DirectTicketForm({outlet,attempt,items}: {outlet:string;attempt:string;items:MenuItem[]}) {
  const [channel,setChannel] = useState('takeaway');
  const [rows,setRows] = useState(1);
  const [result,submit] = useActionState(placeDirectTicketAction,null);
  return <Panel title="New direct ticket" meta="Payment is recorded separately at the counter">
    {/* Returning action errors must not reset fields while retaining the
        same idempotency key. The success path navigates away. */}
    <form action={submit} onReset={event => event.preventDefault()} className="grid gap-3 px-5 py-4">
      <input type="hidden" name="outlet" value={outlet} /><input type="hidden" name="attempt" value={attempt} />
      <p className="text-sm text-gink-64">Use for food supplied directly by this outlet. No marketplace, cross-state fulfilment, catering, discounts or separate delivery charges. Regular GST delivery requires a current PAN review confirming no IRN is needed even if the buyer is registered.</p>
      <Field label="Fulfilment" htmlFor="direct-channel"><select name="channel" id="direct-channel" className={inputClass} value={channel} onChange={e => setChannel(e.target.value)}>
        <option value="takeaway">Takeaway from this outlet</option><option value="direct_delivery">Direct delivery within the outlet state</option>
      </select></Field>
      {channel === 'direct_delivery' && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Destination state" htmlFor="direct-state"><select id="direct-state" required name="state" className={inputClass} defaultValue=""><option value="" disabled>Choose actual destination state</option>
          {Object.entries(GST_OUTLET_STATES).map(([code,label]) => <option key={code} value={code}>{label}</option>)}
        </select></Field>
        <Field label="Delivery address (private)" htmlFor="direct-address"><input id="direct-address" name="address" className={inputClass} minLength={5} maxLength={180} required /></Field>
      </div>}
      {Array.from({length:rows},(_,i) => <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3" key={i}>
        <Field label={`Menu item ${i+1}`} htmlFor={`direct-item-${i}`}><select id={`direct-item-${i}`} name="menuLine" className={inputClass} required={i===0} defaultValue="">
          <option value="">Select an item</option>{items.flatMap(item => [
            <option key={item.id} value={item.id}>{item.name} · {formatBillMoney(item.price_paise)}</option>,
            ...item.variants.map(v => <option key={v.id} value={`${item.id}:${v.id}`}>{item.name} · {v.name} · {formatBillMoney(v.price_paise)}</option>),
          ])}
        </select></Field>
        <Field label="Qty" htmlFor={`direct-qty-${i}`}><input id={`direct-qty-${i}`} name="quantity" type="number" min={1} max={99} defaultValue={1} className={inputClass} required /></Field>
      </div>)}
      <div><button type="button" className={btn('quiet','sm')} disabled={rows>=30} onClick={() => setRows(n => n+1)}>Add menu line</button></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="attested" required /> I verified this is direct restaurant service at or within the saved premises state, without third-party collection or a separate transport supply.</label>
      {result?.error && <p role="alert" className="text-sm font-semibold text-[var(--p-due)]">{result.error}</p>}
      <div><SubmitButton pendingLabel="Recording ticket…" tone="solid">Record ticket</SubmitButton></div>
    </form>
  </Panel>;
}
