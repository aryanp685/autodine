import type { Metadata } from 'next';
import Link from 'next/link';
import { btn } from '@/components/owner/chrome';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { IRP_PAGE_SIZE, IRP_REGISTER_PATH as path, irpFilterParams, irpSourcePath, loadIrpRegister, parseIrpFilters } from '@/lib/db/irp-register';
import { isLocalIrpSimulation } from '@/lib/gst/adapter';
import { addBillingDays } from '@/lib/gst/onboarding';
import { queueIrpDispatch, selectIrpRoute } from './actions';
import { eventLabel, indiaTime, IrpNotice, phaseLabel } from './copy';

export const metadata: Metadata = {title:'IRP register · AutoDine',robots:{index:false,follow:false}};
export const dynamic = 'force-dynamic';
const card='rounded-[14px] border border-hair bg-card p-4';
const input='rounded-lg border border-hair bg-card px-2 py-1.5 text-sm text-gink';
const anchor='underline underline-offset-2';

export default async function IrpRegisterPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const q=await searchParams, staff=await getStaffContextDetailed();
  if (!staff.ok || !['owner','manager'].includes(staff.context.role)) return <main className="p-6"><h1>IRP register unavailable</h1><p>Sign in as an owner or manager of the selected outlet.</p></main>;
  const params=new URLSearchParams();
  for (const key of ['from','to','queue','page']) if (typeof q[key]==='string') params.set(key,q[key]);
  const filters=parseIrpFilters(params), r=filters?await loadIrpRegister(staff.context,filters):null;
  const {restaurantId,restaurantName,role,entitlement}=staff.context;
  const canSim=isLocalIrpSimulation() && role==='owner' && entitlement?.canWrite===true;
  const download=r && filters?irpFilterParams(filters,1):null;
  download?.set('outlet',restaurantId);
  const pages=r?Math.min(10001,Math.ceil(r.total/IRP_PAGE_SIZE)):0;
  const routeReady=r?.routing.available && r.routes.some(x=>x.id===r.routing.id && x.tier==='simulation');
  return <main className="mx-auto max-w-[1160px] space-y-4 px-4 py-6 text-gink sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link href="/dashboard/invoices" className={anchor}>← Invoice history</Link>
        <h1 className="mt-2 text-[24px] font-semibold tracking-tight">E-invoice / IRP register</h1>
        <p className="mt-1 text-sm text-gink-64">{restaurantName} · Selected outlet only</p>
      </div>
      {download?<Link prefetch={false} href={`${path}/export?${download}`} className={btn('ghost','sm')}>Download dispatch CSV</Link>:null}
    </header>
    <p className={card}><strong>No live IRP is enabled.</strong> Local simulation does not submit to GST, generate a legal IRN or release a held document.</p>
    <IrpNotice code={q.notice}/>
    {!r || !filters ? <section className={card}><h2 className="font-semibold">{filters?'Register unavailable':'Invalid dates or page'}</h2>
      <p className="mt-1 text-sm">{filters?'The dispatch schema may be unavailable. Do not infer a clear or empty queue.':'Choose both India dates, at most 366 days, or leave both blank.'}</p>
      <Link href={path} className={anchor}>Reload register</Link></section> : <>
      <section aria-label="Eligibility and routing" className={`${card} grid gap-4 md:grid-cols-2`}>
        <div>
          <h2 className="font-semibold">Eligibility evidence</h2>
          <p className="mt-1 text-sm">Ordinary B2C bills do not use IRP. From 1 August 2023, a non-exempt supplier with PAN-wide turnover above ₹5 crore in any prior FY since 2017–18 needs IRP for covered B2B and export documents.</p>
          <p className="mt-2 text-sm"><strong>Recorded outlet position:</strong> {r.eligibility.mode==='regular'?(r.eligibility.decision==='required'?'Turnover test met for covered supplies.':r.eligibility.decision==='not_required'?'Recorded turnover is at or below the mandate threshold.':'Current PAN-wide review missing, conflicting or stale. Do not assume exemption.')
            : r.eligibility.mode==='composition'?'Composition — Bill of Supply is outside IRP.':r.eligibility.mode==='off'?'Normal billing is outside IRP.':'No reviewed GST profile shown.'}</p>
          {r.eligibility.fy?<p className="text-sm text-gink-64">Saved review FY {r.eligibility.fy}–{String(r.eligibility.fy+1).slice(-2)}, profile v{r.eligibility.version??'—'}. {r.eligibility.category==='at_least_10cr'?'30-day restriction applies.':r.eligibility.category==='under_10cr'?'Below the GSTN ₹10 crore reporting band.':'Reporting category unavailable.'}</p>:null}
          <p className="mt-1 text-sm text-gink-64">Saved document decisions are not reclassified here. Export, SEZ and other special flows are not supported by this route.</p>
        </div>
        <div>
          <h2 className="font-semibold">Outlet routing</h2>
          <p className="mt-1 text-sm">{routeReady?'A local simulation route is selected.':'No compatible simulation route selected.'} Existing jobs keep their original route.</p>
          {canSim?<form action={selectIrpRoute} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="outlet" value={restaurantId}/><input type="hidden" name="revision" value={r.routing.revision}/>
            <label className="grid gap-1 text-sm">Approved local route<select className={input} name="route" defaultValue={routeReady?r.routing.id??'':''}>
              <option value="">Disabled</option>{r.routes.filter(x=>x.tier==='simulation').map(x=><option key={x.id} value={x.id}>{x.provider} · {x.apiVersion} · INV-01 {x.schema}</option>)}
            </select></label>
            <button className={btn('solid','sm')}>Save route</button>
          </form>:<p className="mt-2 text-sm text-gink-64">Read only. Routing is managed by an entitled owner in an isolated local simulation. No credential controls are available.</p>}
        </div>
      </section>
      <section aria-label="Held documents" className={card}>
        <h2 className="font-semibold">Before dispatch</h2>
        <p className="mt-1 text-sm text-gink-64">{r.missingCount} issued held document{r.missingCount===1?'':'s'} with no offline preparation. Showing up to 25 most recent; open a document to review its saved facts.</p>
        {r.missing.length?<ul className="mt-2 space-y-1 text-sm">{r.missing.map(x=><li key={x.documentId}><Link className={anchor} href={irpSourcePath(x.kind,x.documentId)}>{x.number}</Link> · {x.applicability==='required'?'IRN required':'Issue-time applicability unconfirmed — reconcile'}</li>)}</ul>:null}
        <h3 className="mt-4 text-sm font-semibold">Prepared offline, not queued</h3>
        {!r.drafts.length?<p className="mt-1 text-sm text-gink-64">No unqueued offline preparations.</p>:<ul className="mt-2 divide-y divide-hair text-sm">
          {r.drafts.map(x=><li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><Link className={anchor} href={irpSourcePath(x.kind,x.documentId)}>{x.number}</Link> · INV-01 {x.version} · {indiaTime(x.recordedAt)}</span>
            {canSim&&routeReady?<form action={queueIrpDispatch}><input type="hidden" name="outlet" value={restaurantId}/><input type="hidden" name="preflight" value={x.id}/>
              <button className={btn('ghost','sm')}>Queue simulation</button></form>:null}
          </li>)}
        </ul>}
      </section>
      <section aria-label="Dispatch register" className={card}>
        <h2 className="font-semibold">Dispatch register</h2>
        <form action={path} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">Issue date from (India)<input className={input} type="date" name="from" defaultValue={filters.from}/></label>
          <label className="grid gap-1">Issue date through (India)<input className={input} type="date" name="to" defaultValue={filters.to}/></label>
          <label className="flex items-center gap-1 pb-1"><input type="checkbox" name="queue" value="1" defaultChecked={filters.followup}/> Follow-up only</label>
          <button className={btn('ghost','sm')}>Apply filters</button><Link href={path} className={anchor}>Reset</Link>
        </form>
        <p className="my-3 text-sm">{r.total} matching · {r.verifiedAuthority} verified active authority · {r.verifiedSimulation} verified active simulation (not legal)</p>
        {!r.rows.length?<p className="text-sm text-gink-64">No dispatches on this page.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="border-b border-hair"><th className="py-2">Document</th><th>Environment / status</th><th>Reporting deadline (India)</th><th>Latest activity</th></tr></thead>
          <tbody>{r.rows.map(x=>{
            const close=x.deadline && !x.verifiedActive && x.phase!=='cancelled' && x.deadline<=addBillingDays(r.asOf,3);
            return <tr key={x.id} className="border-b border-hair align-top">
              <td className="py-2 pr-4"><Link className={anchor} href={`${path}/${x.id}`}>{x.number}</Link><br/>{x.issueDate}</td>
              <td className="py-2 pr-4"><strong>{x.tier==='simulation'?'Simulation':'Authority'}</strong> · {phaseLabel(x.phase,x.tier,x.verifiedActive)}
                {!x.routeAvailable || x.phase==='queued'&&!x.routeSelected?<div className="text-gink-64">Pinned route unavailable for this operation</div>:null}</td>
              <td className="py-2 pr-4">{x.deadline??'No 30-day cutoff recorded'}{close?<div className="font-semibold">{x.deadline!<r.asOf?'Passed — reconcile':x.deadline===r.asOf?'Today — urgent':'Due soon'}</div>:null}</td>
              <td className="py-2">{eventLabel(x.lastCode)}<br/><span className="text-gink-64">{indiaTime(x.updatedAt)}</span></td>
            </tr>;
          })}</tbody>
        </table></div>}
        {pages>1||filters.page>1?<nav aria-label="Dispatch pages" className="mt-2 flex gap-3 text-sm">
          {filters.page>1?<Link className={anchor} href={`${path}?${irpFilterParams(filters,filters.page-1)}`}>Previous</Link>:null}
          <span>Page {filters.page}</span>{filters.page<pages?<Link className={anchor} href={`${path}?${irpFilterParams(filters,filters.page+1)}`}>Next</Link>:null}
        </nav>:null}
      </section>
      <section aria-label="Provider activity" className={card}>
        <h2 className="font-semibold">Provider activity</h2>
        <p className="mt-1 text-sm text-gink-64">Recorded worker outcomes and elapsed time for matching documents. Failures may include abandoned claims with no completion. Simulation and authority never share a success count.</p>
        {r.providers.length?<ul className="mt-2 space-y-1 text-sm">{r.providers.map(x=><li key={`${x.tier}:${x.provider}:${x.version}`}>
          {x.tier} · {x.provider} {x.version} · {x.completions} outcomes · {x.failures} failures · mean {x.mean??'—'} ms / max {x.max??'—'} ms</li>)}</ul>:<p className="mt-2 text-sm">No worker outcomes recorded.</p>}
      </section>
    </>}
  </main>;
}
