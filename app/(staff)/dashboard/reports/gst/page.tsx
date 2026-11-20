import Link from 'next/link';
import { btn, Field, inputClass, Notice, OwnerPage, PageHead, Panel } from '@/components/owner/chrome';
import { getOutletBar } from '@/lib/db/outlet-bar';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { finalDocument, getGstFilters, GST_FINANCE_PROFILES, gstMoney, gstProfile, gstStatus, loadGstLedger, PAYMENTS_NOTE, type GstLedger } from '@/lib/db/gst-reconciliation';

export const dynamic = 'force-dynamic';
const LABELS: Record<string,string> = { gst_tax_invoice:'Tax invoice', bill_of_supply:'Bill of Supply', retail_bill:'Retail bill', receipt:'Legacy receipt', credit_note:'Credit note', debit_note:'Debit note' };
const fmt = (v: number | null) => gstMoney(v) || '—';

export default async function GstLedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [staff, outlet, params] = await Promise.all([getStaffContextDetailed(), getOutletBar(), searchParams]);
  const allowed = staff.ok && ['owner','manager'].includes(staff.context.role);
  const f = getGstFilters({ get: (key) => params[key] });
  let report: GstLedger | undefined;
  if (allowed && f) {
    try { report = await loadGstLedger(staff.context, f, 100); } catch { /* no fallback fabricated totals */ }
  }
  const groups = report?.buckets.filter(finalDocument) ?? [];
  const billed = groups.filter((r) => !['credit_note','debit_note'].includes(r.kind)).reduce((n,r) => n + r.gross_paise,0);
  const credits = groups.filter((r) => r.kind === 'credit_note').reduce((n,r) => n + r.gross_paise,0);
  const debits = groups.filter((r) => r.kind === 'debit_note').reduce((n,r) => n + r.gross_paise,0);
  const collected = report?.payments.filter((r) => r.status === 'recorded').reduce((n,r) => n+r.amount_paise,0) ?? 0;
  const refunded = report?.payments.filter((r) => r.status === 'refunded').reduce((n,r) => n+r.amount_paise,0) ?? 0;
  const outlets = new Map(report?.outlets.map(row => [row.id,row.name]));
  const consolidated = f?.scope === 'account';
  return (
    <OwnerPage active="reports" wide outlet={outlet} signOut>
      <PageHead kicker={consolidated ? "Finance · authorized account outlets" : "Finance · selected outlet"} title="GST reconciliation" meta="Saved document and collection evidence · India dates · not a GST return" />
      <Link className={btn('quiet','sm')} href="/dashboard/reports">← Sales reports</Link>
      {!allowed ? <Notice tone="due" label="Access required">Owner or Manager permission is required.</Notice> : <>
        <form method="get" className="my-4 grid gap-3 rounded-[12px] border border-hair bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" action="/dashboard/reports/gst">
          <Field label="Outlets" htmlFor="gst-recon-scope"><select className={inputClass} id="gst-recon-scope" name="scope" defaultValue={f?.scope ?? 'selected'}>
            <option value="selected">Selected outlet</option><option value="account">Authorized outlets in this account</option>
          </select></Field>
          <Field label="Profile" htmlFor="gst-recon-profile"><select className={inputClass} id="gst-recon-profile" name="profile" defaultValue={f?.profile ?? ''}>
            <option value="">All profiles</option>{Object.entries(GST_FINANCE_PROFILES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
          </select></Field>
          <Field label="Lifecycle" htmlFor="gst-recon-status"><select className={inputClass} id="gst-recon-status" name="status" defaultValue={f?.status ?? ''}>
            <option value="">All statuses</option><option value="issued">Issued</option><option value="held">IRN hold</option>
            <option value="voided">Voided locally</option><option value="cancelled">IRP cancelled (recorded)</option>
          </select></Field>
          <Field label="From (India)" htmlFor="gst-recon-from"><input className={inputClass} id="gst-recon-from" name="from" type="date" defaultValue={f?.from} /></Field>
          <Field label="Through (India)" htmlFor="gst-recon-through"><input className={inputClass} id="gst-recon-through" name="through" type="date" defaultValue={f?.through} /></Field>
          <Field label="Financial year" htmlFor="gst-recon-fy"><input className={inputClass} id="gst-recon-fy" name="fy" placeholder="26-27" maxLength={5} defaultValue={f?.fy} /></Field>
          <Field label="Series prefix" htmlFor="gst-recon-series"><input className={inputClass} id="gst-recon-series" name="series" maxLength={3} defaultValue={f?.series} /></Field>
          <Field label="Buyer type" htmlFor="gst-recon-audience"><select className={inputClass} id="gst-recon-audience" name="audience" defaultValue={f?.audience ?? ''}>
            <option value="">All</option><option>B2B</option><option>B2C</option><option value="unknown">Not recorded</option>
          </select></Field>
          <Field label="Activation effective date" htmlFor="gst-recon-effective"><input className={inputClass} id="gst-recon-effective" name="effective" type="date" defaultValue={f?.effective} /></Field>
          <Field label="GSTIN or document prefix" htmlFor="gst-recon-reference"><input className={inputClass} id="gst-recon-reference" name="reference" maxLength={16} defaultValue={f?.reference} /></Field>
          <div className="flex items-end"><button className={btn('solid','sm')} type="submit">Apply filters</button></div>
        </form>
        {!report || !f ? <Notice tone="due" label="Report unavailable">{f ? 'GST reconciliation is unavailable on this database.' : 'Check the dates and filters (maximum 366 days).'}</Notice> : <div className="grid gap-4">
          <p className="text-sm text-gink-64">Includes {report.outlets.length} authorized outlet{report.outlets.length === 1 ? '' : 's'}: {report.outlets.map(row => row.name).join(', ')}.</p>
          <Panel title="Billed and collected (₹)" meta="Document filters apply to billed amounts only">
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
              <p>Issued gross <strong className="block tabular-nums">{fmt(billed)}</strong></p>
              <p>Credit / debit notes <strong className="block tabular-nums">{fmt(credits)} / {fmt(debits)}</strong></p>
              <p>Recorded collections <strong className="block tabular-nums">{fmt(collected)}</strong></p>
              <p>Payment rows marked refunded <strong className="block tabular-nums">{fmt(refunded)}</strong></p>
            </div>
            <p className="px-4 pb-3 text-[12px] text-gink-64">{PAYMENTS_NOTE} Issued gross excludes voids, cancelled records, notes and holds. Billing and payment timing can differ.</p>
          </Panel>
          <details className="rounded-[12px] border border-hair bg-card p-4">
            <summary className="cursor-pointer font-medium">Tax totals by document group</summary>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[750px] text-left text-xs tabular-nums">
              <thead><tr className="border-y border-hair">{['Outlet · FY / Series','Billing profile','Buyer','Status','Count','Taxable','CGST','SGST','IGST','Gross'].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead>
              <tbody>{report.buckets.map((r) => <tr key={[r.outlet_id,r.financial_year,r.series,r.kind,r.profile,r.rate_bps,r.audience,r.status,r.irp_status].join(':')} className="border-b border-hair">
                <td className="p-2">{outlets.get(r.outlet_id)} · {r.financial_year} / {r.series}</td><td className="p-2">{LABELS[r.kind] ?? r.kind} · {gstProfile(r.profile)}{r.rate_bps != null ? ` · ${r.rate_bps/100}%` : ""}</td>
                <td className="p-2">{r.audience}</td><td className="p-2">{gstStatus(r)}</td><td className="p-2">{r.count}</td>
                {[r.taxable_paise,r.cgst_paise,r.sgst_paise,r.igst_paise,r.gross_paise].map((v,i) => <td className="p-2" key={i}>{fmt(v)}</td>)}
              </tr>)}</tbody>
            </table></div>
          </details>
          <details className="rounded-[12px] border border-hair bg-card p-4">
            <summary className="cursor-pointer font-medium">Payment evidence by outlet</summary>
            <ul className="mt-2 divide-y divide-hair text-sm">{report.payments.map(r => <li key={`${r.outlet_id}:${r.status}:${r.linked_to}`} className="py-2">
              {outlets.get(r.outlet_id)} · {r.status} · {r.linked_to.replaceAll('_',' ')} · {r.count} rows · ₹{fmt(r.amount_paise)}
            </li>)}</ul>
          </details>
          <Panel title="Saved documents" meta={`${report.document_count} matching · showing up to 100`}>
            <div className="px-4 py-3"><a className={btn('ghost','sm')} download href={`/dashboard/reports/gst/export?${new URLSearchParams({ ...f,outlet:report.outlet })}`}>Download GST ledger CSV</a></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs tabular-nums">
              <thead><tr className="border-y border-hair">{['Document','Type','Buyer','Status','Taxable','CGST','SGST','IGST','Gross'].map((x) => <th className="p-2" key={x}>{x}</th>)}</tr></thead>
              <tbody>{report.documents.map((r) => <tr className="border-b border-hair" key={`${r.outlet_id}:${r.kind}:${r.id}`}>
                <td className="p-2">{r.outlet_id === report.outlet ? <Link className="underline" href={`${r.kind.endsWith('_note') ? '/dashboard/invoices/notes/' : '/invoice/'}${r.id}`}>{r.number}</Link> : <b>{r.number}</b>}
                  <span className="block text-gink-64">{outlets.get(r.outlet_id)}{r.outlet_id !== report.outlet ? ' · Switch outlet to open' : ''}</span><span className="block text-gink-64">{r.effective_from ? `Active from ${r.effective_from}` : 'Legacy / effective date not recorded'}{r.source_number ? ` · Ref ${r.source_number}` : ''}</span></td>
                <td className="p-2">{LABELS[r.kind] ?? r.kind}<span className="block text-gink-64">{gstProfile(r.profile)}</span></td>
                <td className="p-2">{r.audience === 'unknown' ? '—' : r.audience}<span className="block text-gink-64">{r.buyer_gstin}</span></td>
                <td className="p-2">{gstStatus(r)}</td>{[r.taxable,r.cgst,r.sgst,r.igst,r.gross].map((v,i) => <td className="p-2" key={i}>{fmt(v)}</td>)}
              </tr>)}</tbody>
            </table></div>
          </Panel>
        </div>}
      </>}
    </OwnerPage>
  );
}
