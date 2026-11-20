import Link from 'next/link';
import { notFound } from 'next/navigation';
import { btn } from '@/components/owner/chrome';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { IRP_REGISTER_PATH, irpSourcePath, loadIrpDispatch } from '@/lib/db/irp-register';
import { isLocalIrpSimulation } from '@/lib/gst/adapter';
import { GST_UUID } from '@/lib/gst/buyer';
import { IRP_CANCEL_REASONS } from '@/lib/gst/irp/types';
import { canCancelAt, indiaDay } from '@/lib/gst/irp/execution/verification';
import { requestIrpAction } from '../actions';
import { eventLabel, indiaTime, IrpNotice, phaseLabel } from '../copy';

export const dynamic='force-dynamic';
const card='rounded-[14px] border border-hair bg-card p-4';

export default async function IrpDispatchPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{notice?:string}>}) {
  const [{id},q, staff]=await Promise.all([params,searchParams,getStaffContextDetailed()]);
  if (!GST_UUID.test(id) || !staff.ok || !['owner','manager'].includes(staff.context.role)) notFound();
  const job=await loadIrpDispatch(staff.context,id);
  if (!job) notFound();
  const now=Date.now();
  const owner=isLocalIrpSimulation() && staff.context.role==='owner' && staff.context.entitlement?.canWrite===true && job.tier==='simulation';
  const lookup=job.lookupAttempts<30 && (job.phase==='ambiguous'||job.phase==='cancel_ambiguous');
  const retry=job.routeAvailable && job.routeSelected && job.generationAttempts<8 && job.phase==='retryable'
    && (!job.deadline || indiaDay(now)<=job.deadline);
  const cancel=job.routeAvailable && job.phase==='accepted' && job.cancellationAttempts<4 && canCancelAt(job.copy?.acknowledgedAt,now);
  const operation=lookup?'lookup':retry?'retry':cancel?'cancel':null;
  return <main className="mx-auto max-w-[880px] space-y-4 px-4 py-6 text-gink sm:px-6">
    <header>
      <Link className="underline underline-offset-2" href={IRP_REGISTER_PATH}>← IRP register</Link>
      <h1 className="mt-2 text-[24px] font-semibold tracking-tight">Dispatch {job.number}</h1>
      <p className="mt-1 text-sm text-gink-64">{staff.context.restaurantName} · {job.tier==='simulation'?'Simulation — not filed with GST':'Authority record'}</p>
    </header>
    <IrpNotice code={q.notice}/>
    <section className={card}>
      <h2 className="font-semibold">{phaseLabel(job.phase,job.tier,job.copy!==null)}</h2>
      <p className="mt-1 text-sm">{job.provider} · {job.apiVersion} · INV-01 {job.schemaVersion} · revision {job.revision}</p>
      <p className="mt-1 text-sm">Issue date {job.issueDate} (India) · Rule {job.rule} · Reporting deadline: {job.deadline??'no 30-day cutoff recorded'}</p>
      <p className="mt-1 text-sm">Claims: {job.generationAttempts} generate · {job.lookupAttempts} lookup · {job.cancellationAttempts} cancel</p>
      {(['queued','retryable','ambiguous','lookup_queued','cancel_ambiguous','cancel_lookup_queued'].includes(job.phase)&&job.nextAt)?<p className="mt-1 text-sm">Not before {indiaTime(job.nextAt)}</p>:null}
      {!job.routeAvailable || ['queued','retryable'].includes(job.phase)&&!job.routeSelected?<p className="mt-1 text-sm font-semibold">Pinned route unavailable for this operation.</p>:null}
      {job.cancelledAt?<p className="mt-1 text-sm">Cancellation recorded at {indiaTime(job.cancelledAt)}. Saved GST and payment history were not changed.</p>:null}
      <Link className="mt-2 inline-block text-sm underline underline-offset-2" href={irpSourcePath(job.kind,job.documentId)}>Open saved {job.kind}</Link>
    </section>
    {job.copy?<section className={`${card} ${job.copy.tier==='simulation'?'print:hidden':''}`} aria-label="Verified evidence">
      <h2 className="font-semibold">{job.copy.tier==='simulation'?'Verified synthetic evidence — not an IRN':'Verified IRP evidence'}</h2>
      <p className="mt-2 break-all text-sm">{job.copy.tier==='simulation'?'Simulation reference':'IRN'}: <span className="font-mono">{job.copy.reference}</span></p>
      <p className="mt-1 break-all text-sm">{job.copy.tier==='simulation'?'Simulation acknowledgement':'Acknowledgement'}: <span className="font-mono">{job.copy.acknowledgement}</span> · {indiaTime(job.copy.acknowledgedAt)}</p>
      <p className="mt-1 text-sm text-gink-64">{job.copy.tier==='simulation'?'Both signed test payloads were verified. No customer QR or copy is issued.':'Open the private document for the signed QR copy.'}</p>
    </section>:null}
    <section className={card} aria-label="Recovery actions">
      <h2 className="font-semibold">Recovery actions</h2>
      <p className="mt-1 text-sm">Uncertain outcomes must be looked up before any resend. No manual success entry or replacement invoice number is available here.</p>
      {owner&&operation?<form className="mt-3 flex flex-wrap items-end gap-2" action={requestIrpAction}>
        <input type="hidden" name="outlet" value={staff.context.restaurantId}/><input type="hidden" name="dispatch" value={id}/>
        <input type="hidden" name="operation" value={operation}/><input type="hidden" name="revision" value={job.revision}/>
        {operation==='cancel'?<label className="grid gap-1 text-sm">Simulation cancellation reason<select className="rounded-lg border border-hair bg-card p-2" name="reason" defaultValue="" required>
          <option value="" disabled>Select reason</option>{Object.entries(IRP_CANCEL_REASONS).map(([key,value])=><option key={key} value={key}>{value}</option>)}
        </select></label>:null}
        <button className={btn('ghost','sm')}>{operation==='lookup'?'Request lookup':operation==='retry'?'Queue retry':'Queue simulation cancellation'}</button>
      </form>:<p className="mt-2 text-sm text-gink-64">{owner?'No action is permitted in this state or time window. Reconcile unresolved records with the operator.':'Read only — no transport or status override is available.'}</p>}
    </section>
    <section className={card} aria-label="Dispatch audit history">
      <h2 className="font-semibold">Dispatch audit history</h2>
      <ol className="mt-2 divide-y divide-hair text-sm">
        {job.events.map(e=><li key={e.rev} className="space-y-0.5 py-2">
          <p>#{e.rev} · {eventLabel(e.code)} · {indiaTime(e.at)}{e.latency===null?'':` · ${e.latency} ms`}</p>
          <p className="text-gink-64">{phaseLabel(e.phase,job.tier,true)}</p>
          {Object.hasOwn(IRP_CANCEL_REASONS,e.reasonCode)?<p>Reason: {IRP_CANCEL_REASONS[e.reasonCode as keyof typeof IRP_CANCEL_REASONS]}</p>:null}
          {e.digest?<p className="break-all text-gink-64">Evidence digest: <span className="font-mono">{e.digest}</span></p>:null}
        </li>)}
      </ol>
    </section>
  </main>;
}
