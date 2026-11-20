/** All data comes from caller-RLS-scoped issued snapshots, never today's profile. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EinvoiceInvoiceInput, EinvoiceProfileInput } from './einvoice';
import { validIndianBillingDate } from './onboarding';

type Sources = { invoice: EinvoiceInvoiceInput; profile: EinvoiceProfileInput; timeZone: string };
export type LoadEinvoiceSourcesResult = { ok: true; sources: Sources } | { ok: false; error: string };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v : '';
const money = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) ? v : NaN;
const ZONE = 'Asia/Kolkata';

export function localDateInTimeZone(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.valueOf())) return null;
  for (const zone of [timeZone, ZONE, 'UTC']) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
    catch { /* fallback for display callers; GST uses the explicit India zone */ }
  }
  return null;
}

export async function loadEinvoiceSources(supabase: SupabaseClient, restaurantId: string, id: string,
  kind: 'invoice' | 'note' = 'invoice'): Promise<LoadEinvoiceSourcesResult> {
  const fields = 'id,restaurant_id,document_type,status,issued_at,totals_snapshot,gst_snapshot,seller_snapshot,customer_snapshot,irp_status';
  const { data: loaded, error } = await supabase.from(kind === 'invoice' ? 'restaurant_invoices' : 'restaurant_notes')
    .select(fields + (kind === 'invoice' ? ',invoice_number' : ',document_number,invoice_id,source_document_number,source_issued_at'))
    .eq('id', id).eq('restaurant_id', restaurantId).maybeSingle();
  if (error || !loaded) return { ok: false, error: 'The saved document is unavailable in the selected outlet.' };
  const row = object(loaded);
  const gst = object(row.gst_snapshot), seller = object(row.seller_snapshot), buyer = object(row.customer_snapshot);
  const totals = object(row.totals_snapshot);
  const evidence = object(gst.irp_evidence);
  const reporting = evidence.reporting_category === 'at_least_10cr' || evidence.reporting_category === 'under_10cr' ? evidence.reporting_category : 'unknown';
  const applicability = evidence.rule_version === '13-2020-amended-10-2023' && evidence.applicability === 'required' ? 'required' : 'unknown';
  const issued = text(gst.issued_local_date);
  if (!validIndianBillingDate(issued) || issued !== localDateInTimeZone(text(row.issued_at), ZONE) || !text(seller.premises_state_code)) {
    return { ok: false, error: 'Issue-time date or premises evidence is missing. The legacy document stays on hold for reconciliation.' };
  }
  const invoiceId = kind === 'invoice' ? id : text(row.invoice_id);
  let originalInvoice: EinvoiceInvoiceInput['originalInvoice'];
  if (kind === 'note') {
    const { data: parent, error: parentError } = await supabase.from('restaurant_invoices').select('document_type,invoice_number,issued_at,status')
      .eq('id', invoiceId).eq('restaurant_id', restaurantId).maybeSingle();
    const parentDate = localDateInTimeZone(text(row.source_issued_at), ZONE);
    if (parentError || !parent || !parentDate || parent.document_type !== 'gst_tax_invoice' || parent.status !== 'issued'
      || parent.invoice_number !== row.source_document_number || localDateInTimeZone(parent.issued_at, ZONE) !== parentDate) {
      return { ok: false, error: 'The saved note does not reconcile to an issued original invoice.' };
    }
    originalInvoice = { documentType: 'INV', documentNumber: parent.invoice_number, issuedDate: parentDate };
  }
  const { data: lines, error: linesError } = await supabase.from('restaurant_invoice_lines').select('line_number,line_snapshot')
    .eq('invoice_id', invoiceId).eq('restaurant_id', restaurantId).order('line_number', { ascending: true });
  if (linesError || !lines?.length) return { ok: false, error: 'Saved line evidence is unavailable.' };
  return { ok: true, sources: { timeZone: ZONE,
    invoice: {
      invoiceNumber: text(row.invoice_number ?? row.document_number), issuedLocalDate: issued, originalInvoice,
      irpStatus: text(row.irp_status), status: text(row.status), documentType: text(row.document_type),
      irpEvidence: { applicability, reportingCategory: reporting },
      gst: { rateBps: money(gst.rate_bps), taxablePaise: money(gst.taxable_paise), cgstPaise: money(gst.cgst_paise),
        sgstPaise: money(gst.sgst_paise), igstPaise: money(gst.igst_paise), placeOfSupplyStateCode: text(gst.place_of_supply_state_code) },
      totals: { totalPaise: money(totals.total_paise), subtotalPaise: money(totals.subtotal_paise), taxPaise: money(totals.tax_paise) },
      seller: { name: text(seller.name), address: text(seller.address), tradeName: text(seller.trade_name) || null, phone: text(seller.phone) || null },
      recipient: text(buyer.gstin) ? { name: text(buyer.name), gstin: text(buyer.gstin), address: text(buyer.address) || null,
        email: text(buyer.email) || null, location: text(buyer.location), pincode: text(buyer.pincode), phone: text(buyer.phone) || null } : null,
      lines: lines.map((line) => { const snap = object(line.line_snapshot); return { itemName: text(snap.item_name), quantity: money(snap.quantity),
        unitPricePaise: money(snap.unit_price_paise), amountPaise: money(snap.amount_paise) }; }),
    },
    profile: { mode: text(gst.mode), registrationType: text(seller.registration_type), gstin: text(seller.gstin), legalName: text(seller.legal_name),
      tradeName: text(seller.trade_name) || null, address: text(seller.address), stateCode: text(seller.state_code),
      precedingFyTurnoverPaise: null, einvoiceLocation: text(seller.einvoice_location), einvoicePincode: text(seller.einvoice_pincode), einvoiceHsnSac: text(gst.service_sac) },
  } };
}
