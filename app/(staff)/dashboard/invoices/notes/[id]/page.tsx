import { notFound } from 'next/navigation';
import Link from 'next/link';
import { VerifiedIrpBlock } from '@/components/screens/VerifiedIrpBlock';
import { readPrivateIrpCopy } from '@/lib/db/irp-document';
import { PrintButton } from '@/components/PrintButton';
import { EinvoiceAttemptButton } from '@/components/screens/EinvoiceAttemptButton';
import { btn } from '@/components/owner/chrome';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { formatBillMoney } from '@/lib/bill';
import { IRP_RULE } from '@/lib/gst/applicability';
import { GST_UUID } from '@/lib/gst/buyer';
import { noteParticulars, snapshotText as value } from '@/lib/gst/notes';
import { gstStateLabel } from '@/lib/gst/onboarding';
import { getIrpPreflightGate } from '@/lib/gst/adapter';
import { localDateInTimeZone } from '@/lib/gst/einvoice-server';

export const dynamic = 'force-dynamic';
const fmtDate = (s: string) => localDateInTimeZone(s,'Asia/Kolkata') ?? 'Date unavailable';

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await getStaffContextDetailed();
  if (!GST_UUID.test(id) || !staff.ok || !['owner','manager'].includes(staff.context.role)) notFound();
  const { supabase, restaurantId, role } = staff.context;
  const { data: note, error } = await supabase.from('restaurant_notes')
    .select('document_number,document_type,status,irp_status,source_document_number,source_issued_at,invoice_id,issued_at,seller_snapshot,customer_snapshot,gst_snapshot,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,reason,void_reason')
    .eq('restaurant_id',restaurantId).eq('id',id).maybeSingle();
  if (error || !note) notFound();
  const copy=note.status==='issued' && ['pending','failed','generated'].includes(note.irp_status)
    ? await readPrivateIrpCopy(staff.context,id,'note') : null;
  const held = note.irp_status !== 'not_required' && !copy;
  const cancelled = note.irp_status === 'cancelled';
  const seller = note.seller_snapshot, buyer = note.customer_snapshot;
  const gst = note.gst_snapshot;
  const evidence = gst && typeof gst==='object' && 'irp_evidence' in gst ? gst.irp_evidence : null;
  const canPrepare = value(evidence,'rule_version')===IRP_RULE.version && value(evidence,'applicability')==='required';
  const particulars = noteParticulars(value(note.gst_snapshot,'source_document_type'), seller, buyer, note.gst_snapshot);
  const incomplete = !particulars || !note.source_document_number || !localDateInTimeZone(note.source_issued_at,'Asia/Kolkata');
  const blocked = held || incomplete;
  const title = note.document_type === 'credit_note' ? 'CREDIT NOTE' : 'DEBIT NOTE';
  return <main className="mx-auto max-w-[760px] p-6 text-gink print:p-0">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Link href="/dashboard/invoices" className={btn('ghost','sm')}>← Invoice history</Link>
      {held ? <Link href="/dashboard/reports/irp" className={btn('ghost','sm')}>IRP register</Link> : null}
      {held && canPrepare && (note.irp_status === 'pending' || note.irp_status === 'failed') && getIrpPreflightGate().ok && role === 'owner' && staff.context.entitlement?.canWrite && note.status === 'issued' ? <EinvoiceAttemptButton invoiceId={id} irpStatus={note.irp_status} kind="note" /> : null}
      {!blocked ? <PrintButton className={btn('solid','sm')}>{note.status === 'voided' ? 'Print voided copy' : 'Print / Save PDF'}</PrintButton> : null}
    </div>
    <article className="space-y-4 rounded-[14px] border border-hair bg-card p-5 print:border-none print:p-0">
      <header>
        <h1 className="text-xl font-semibold">{cancelled ? 'Cancelled GST adjustment' : held ? 'Held GST adjustment' : incomplete ? 'Historical GST adjustment' : title}</h1>
        {held ? <p className="border border-[var(--p-due)] p-2 font-semibold">{cancelled
          ? 'IRP cancellation recorded — do not issue or share this adjustment.' : 'IRN hold — not a final GST document. Do not issue or share.'}</p> : null}
        {incomplete ? <p className="font-semibold">Required particulars are not recorded. For review only — no printable adjustment is available.</p> : null}
        {note.status === 'voided' ? <p className="font-semibold">VOIDED — {note.void_reason}</p> : null}
      </header>
      <div className={`space-y-4 ${blocked ? 'print:hidden' : ''}`}>
        <section>
          <p className="font-mono">{note.document_number} · {fmtDate(note.issued_at)}</p>
          <p>Original: <Link className="underline" href={`/invoice/${note.invoice_id}`}>{note.source_document_number}</Link> · {fmtDate(note.source_issued_at)}</p>
          <p className="mt-2">Reason: {note.reason}</p>
        </section>
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="whitespace-pre-line"><h2 className="font-semibold">Supplier</h2><p>{value(seller,'legal_name') || value(seller,'name')}</p>
            <p>{value(seller,'address')}</p><p>GSTIN {value(seller,'gstin')}</p>{value(seller,'fssai_number') ? <p>FSSAI {value(seller,'fssai_number')}</p> : null}</div>
          <div className="whitespace-pre-line"><h2 className="font-semibold">Recipient</h2>{value(buyer,'name') ? <>
            <p>{value(buyer,'name')}</p><p>{value(buyer,'address')}</p><p>{value(buyer,'location')} {value(buyer,'pincode')}</p>
            <p>{value(buyer,'gstin') ? `GSTIN ${value(buyer,'gstin')}` : 'Unregistered'}</p>
            {value(buyer,'delivery_address') ? <p>Delivery address: {value(buyer,'delivery_address')}</p> : null}
            {gstStateLabel(value(buyer,'state_code')) ? <p>Buyer state: {gstStateLabel(value(buyer,'state_code'))}</p> : null}</> : <p>Recipient not recorded on original</p>}</div>
        </section>
        <p>{value(note.gst_snapshot,'service_sac') ? `SAC ${value(note.gst_snapshot,'service_sac')} · ` : ''}Place-of-supply state: {gstStateLabel(value(note.gst_snapshot,'place_of_supply_state_code')) ?? 'not recorded'}</p>
        {particulars ? <p>Saved tax rate: {particulars.rateBps / 100}%</p> : null}
        <dl className="grid grid-cols-2 gap-2 border-t border-hair pt-3 tabular-nums">
          {([['Taxable value',note.taxable_paise],['CGST',note.cgst_paise],['SGST',note.sgst_paise],['IGST',note.igst_paise],['Adjustment total',note.total_paise]] as const)
            .map(([label,paise]) => <div className="contents" key={label}><dt>{label}</dt><dd className="text-right">{formatBillMoney(Number(paise))}</dd></div>)}
        </dl>
        {copy && !blocked ? <VerifiedIrpBlock copy={copy}/> : null}
        {!blocked && note.status === 'issued' ? <div>
          <p>Supplier or authorized representative signature: ____________________</p>
          <p className="text-sm text-gink-64 print:hidden">This system does not sign the adjustment.</p>
        </div> : null}
        <p className="text-sm text-gink-64">Document adjustment only. This copy is not proof of payment, refund, or adjustment on a filed return.</p>
      </div>
    </article>
  </main>;
}
