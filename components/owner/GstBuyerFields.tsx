'use client';

import { useState, useTransition } from 'react';
import { findGstBuyersAction, saveGstBuyerAction } from '@/app/(staff)/dashboard/gst-buyer-actions';
import type { BuyerFields, CheckoutRecipient, SavedGstBuyer } from '@/lib/gst/buyer';
import { GST_STATE_CODES } from '@/lib/gst/gstin';
import { gstStateLabel } from '@/lib/gst/onboarding';
import { btn } from './chrome';

const EMPTY: BuyerFields = { name:'', gstin:'', address:'', location:'', pincode:'', state_code:'', email:'', phone:'' };
export function GstBuyerFields({ onChange, outletId, canSave, identifiedRequired }: {
  onChange: (recipient: CheckoutRecipient | undefined) => void; outletId?: string; canSave?: boolean; identifiedRequired: boolean;
}) {
  const [type,setType] = useState<'none'|'consumer'|'registered'>(identifiedRequired ? 'consumer' : 'none');
  const [draft,setDraft] = useState<BuyerFields>(EMPTY);
  const [selected,setSelected] = useState<SavedGstBuyer | null>(null);
  const [editing,setEditing] = useState(false);
  const [search,setSearch] = useState('');
  const [results,setResults] = useState<SavedGstBuyer[]>([]);
  const [message,setMessage] = useState('');
  const [pending,startTransition] = useTransition();
  const field = 'mt-0.5 w-full rounded-[var(--p-r-control)] border border-hair bg-card px-1.5 py-1 text-[11.5px] text-gink';
  const emit = (form: BuyerFields, nextType = type) => onChange(nextType === 'consumer'
    ? { recipient_type: 'consumer', name: form.name, address: form.address, state_code: form.state_code }
    : nextType === 'registered' ? form : undefined);
  function reset(next: typeof type) {
    setType(next); setDraft(EMPTY); setSelected(null); setEditing(false); setResults([]); setMessage(''); emit(EMPTY,next);
  }
  function update(key: keyof BuyerFields, value: string) {
    const next = { ...draft,[key]: key === 'gstin' ? value.toUpperCase() : value };
    setDraft(next); emit(next);
  }
  function select(row: SavedGstBuyer) {
    setSelected(row); setDraft(row.details); setEditing(false); setResults([]); setMessage('');
    onChange({ buyer_id: row.id, revision: row.revision });
  }
  function find() {
    setMessage(''); setResults([]);
    startTransition(async () => {
      const result = await findGstBuyersAction(search);
      if (!result.ok) { setMessage(result.error); return; }
      setResults(result.rows); if (!result.rows.length) setMessage('No saved buyer matches. You can enter this invoice’s fields below.');
    });
  }
  function save() {
    if (!outletId || !canSave) return;
    startTransition(async () => {
      const result = await saveGstBuyerAction(outletId, selected?.revision ?? 0, draft);
      if (!result.ok) { setMessage(result.error); return; }
      select(result.buyer); setMessage('Saved for future invoices at this outlet.');
    });
  }
  function input(label: string, key: keyof BuyerFields, max: number, type = 'text') {
    return <label className="block text-[10px] text-gink-64">{label}<input className={field} type={type} value={draft[key] ?? ''}
      maxLength={max} disabled={pending || Boolean(selected && !editing) || (key === 'gstin' && Boolean(selected))} onChange={(e) => update(key,e.target.value)} /></label>;
  }
  return <fieldset className="mb-2 w-full space-y-2 rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-2.5 py-2 text-left">
    <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gink-46">Invoice recipient</legend>
    <label className="block text-[10px] text-gink-64">Buyer type<select className={field} value={type} disabled={pending} onChange={(e) => reset(e.target.value as typeof type)}>
      {!identifiedRequired ? <option value="none">Walk-in (no details)</option> : null}
      <option value="consumer">Unregistered (name and address)</option><option value="registered">Registered business · ordinary B2B</option>
    </select></label>
    {type === 'registered' ? <>
      <label className="block text-[10px] text-gink-64">Search saved GSTIN<input className={field} maxLength={15} value={search} disabled={pending} onChange={(e) => setSearch(e.target.value)} /></label>
      <button className={btn('ghost','sm')} type="button" onClick={find} disabled={pending}>Find buyer</button>
      {results.map((row) => <button className="block w-full rounded border border-hair p-1 text-left text-[11.5px]" type="button" key={row.id} onClick={() => select(row)}>
        {row.details.name} · {row.details.gstin}
      </button>)}
      {selected && !editing ? <p className="text-[10px] text-gink-64">Using saved buyer, revision {selected.revision}. {canSave ? <button type="button" className="underline" onClick={() => setEditing(true)}>Edit buyer</button> : null} <button type="button" className="underline" onClick={() => reset('registered')}>Clear selection</button></p> : null}
    </> : null}
    {type !== 'none' ? <>
      {input(type === 'registered' ? 'Legal name' : 'Buyer name','name',160)}
      {type === 'registered' ? input('GSTIN','gstin',15) : null}
      {input('Billing address','address',300)}
      <label className="block text-[10px] text-gink-64">Buyer state<select className={field} value={draft.state_code ?? ''} disabled={pending || Boolean(selected && !editing)} onChange={(e) => update('state_code',e.target.value)}>
        {type === 'registered' ? <option value="">Use GSTIN state</option> : <option value="">Select state</option>}
        {[...GST_STATE_CODES].filter((code) => !['25','28'].includes(code)).map((code) => <option key={code} value={code}>{gstStateLabel(code)}</option>)}
      </select></label>
    </> : null}
    {type === 'registered' ? <>
      {input('Billing city','location',50)}{input('Billing PIN','pincode',6)}
      {input('Email (optional)','email',100,'email')}{input('Phone (optional)','phone',24,'tel')}
      <p className="text-[10px] text-gink-64">Place of supply is the service premises, not the buyer’s state. Do not use for SEZ, exports, or marketplace supplies.</p>
      {canSave && (!selected || editing) ? <button className={btn('ghost','sm')} type="button" onClick={save} disabled={pending}>{selected ? 'Update saved buyer' : 'Save buyer for future invoices'}</button> : null}
    </> : null}
    {message ? <p role="status" className="text-[10.5px] text-gink-64">{message}</p> : null}
  </fieldset>;
}
