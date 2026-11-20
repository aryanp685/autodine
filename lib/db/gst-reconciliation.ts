import { validIndianBillingDate, addBillingDays } from '@/lib/gst/onboarding';
import { localDateKey, RESTAURANT_TIME_ZONE } from './time';
import type { StaffContext } from './staff';
import { csvDecimal, rupees, toCsv } from './reports';

export const GST_FINANCE_PROFILES = {
  specified_premises:'Specified premises', other_than_specified_premises:'Other than specified premises',
  composition:'Composition', unregistered:'Unregistered', legacy:'Legacy', unknown:'Not recorded',
} as const;
const STATUSES = { issued:'Issued', held:'IRN hold', voided:'Voided locally', cancelled:'IRP cancelled' } as const;
type Lifecycle = keyof typeof STATUSES;
export type GstFinanceScope = 'selected' | 'account';
type GstAmounts = { taxable: number | null; cgst: number | null; sgst: number | null; igst: number | null; gross: number };
type GstGroup = { outlet_id: string; financial_year: string; kind: string; series: string; billing: string; profile: string;
  rate_bps: number | null; audience: string; status: string; irp_status: string; lifecycle: Lifecycle };
export type GstLedgerRow = GstAmounts & GstGroup & {
  id: string; number: string; issued_at: string; effective_from: string | null; buyer_gstin: string | null;
  supplier_gstin: string | null; fulfilment: string | null; profile_version: string | null; voided_at: string | null;
  source_id: string | null; source_number: string | null; source_issued_at: string | null; supersedes_invoice_id: string | null;
  paid_at_issue: number | null; rounding_delta: number | null;
};
type PaymentGroup = { outlet_id: string; status: 'recorded' | 'refunded'; linked_to: string; count: number; amount_paise: number };
export type GstBucket = GstGroup & { count: number; gross_paise: number; taxable_paise: number | null;
  cgst_paise: number | null; sgst_paise: number | null; igst_paise: number | null; missing_tax_count: number; rounding_delta_paise: number | null };
export type GstLedger = { schema_version: 2; outlet: string; scope: GstFinanceScope; outlets: Array<{id:string;name:string}>;
  document_count: number; documents: GstLedgerRow[]; payments: PaymentGroup[]; buckets: GstBucket[] };
export type GstFilters = { from: string; through: string; fy: string; series: string; audience: string; effective: string; reference: string;
  scope: GstFinanceScope; profile: string; status: string };
export const PAYMENTS_NOTE = 'Payments cover the full date range of the included outlets, independent of document filters. Refunded rows use the original recording date; the ledger does not assert the date or amount of a refund event. Notes never move money.';

export function getGstFilters(input: { get(key: string): unknown }, now = new Date()): GstFilters | null {
  const today = localDateKey(RESTAURANT_TIME_ZONE, now);
  const get = (name: string) => {
    const raw = input.get(name);
    return raw == null ? '' : typeof raw === 'string' ? raw.trim() : '\u0000';
  };
  const from = get('from') || addBillingDays(today, -6), through = get('through') || today;
  const fy = get('fy'), series = get('series').toUpperCase(), audience = get('audience');
  const effective = get('effective'), reference = get('reference').toUpperCase();
  const scope = get('scope') || 'selected', profile = get('profile'), status = get('status');
  if (!validIndianBillingDate(from) || !validIndianBillingDate(through) || from > through || through > addBillingDays(from,365)
    || !validIndianBillingDate(addBillingDays(through,1)) || (scope !== 'selected' && scope !== 'account')
    || (profile && !Object.hasOwn(GST_FINANCE_PROFILES,profile)) || (status && !Object.hasOwn(STATUSES,status))
    || (fy && !/^\d{2}-\d{2}$/.test(fy)) || (series && !/^[A-Z0-9]{2,3}$/.test(series))
    || (audience && !['B2B','B2C','unknown'].includes(audience)) || (effective && !validIndianBillingDate(effective))
    || (reference && !/^[A-Z0-9/-]{1,16}$/.test(reference))) return null;
  return { from, through, fy, series, audience, effective, reference, scope, profile, status };
}

export async function loadGstLedger(context: StaffContext, filters: GstFilters, limit: number): Promise<GstLedger> {
  if (context.role !== 'owner' && context.role !== 'manager') throw new Error('GST ledger requires finance access.');
  const { data, error } = await context.supabase.rpc('report_gst_finance', {
    p_outlet: context.restaurantId, p_from: filters.from, p_until: addBillingDays(filters.through,1), p_scope: filters.scope,
    ...(filters.fy ? { p_fy: filters.fy } : {}), ...(filters.series ? { p_series: filters.series } : {}),
    ...(filters.audience ? { p_audience: filters.audience } : {}), ...(filters.effective ? { p_effective_from: filters.effective } : {}),
    ...(filters.reference ? { p_reference: filters.reference } : {}), ...(filters.profile ? {p_profile:filters.profile} : {}),
    ...(filters.status ? {p_status:filters.status} : {}), p_detail_limit: limit,
  });
  const result = data as unknown as GstLedger | null;
  if (error || result?.schema_version !== 2 || result.outlet !== context.restaurantId || result.scope !== filters.scope
    || !Array.isArray(result.documents) || !Array.isArray(result.buckets) || !Array.isArray(result.payments) || !Array.isArray(result.outlets)
    || !Number.isSafeInteger(result.document_count) || result.document_count < 0) {
    throw new Error('GST reconciliation is unavailable on this database.');
  }
  const allowed = new Set(result.outlets.map(o => o.id));
  if (!allowed.has(context.restaurantId) || (filters.scope === 'selected' && allowed.size !== 1)
    || [...result.documents,...result.buckets,...result.payments].some(r => !allowed.has(r.outlet_id))) {
    throw new Error('GST reconciliation scope changed.');
  }
  return result;
}

export const gstMoney = (amount: number | null) => amount === null ? '' : Number.isSafeInteger(amount) ? rupees(amount) : 'Unreadable';
export const finalDocument = (row: Pick<GstGroup, 'lifecycle'>) => row.lifecycle === 'issued';
export const gstStatus = (row: Pick<GstGroup, 'lifecycle'>) => STATUSES[row.lifecycle] ?? 'Not recorded';
export const gstProfile = (key: string) => GST_FINANCE_PROFILES[key as keyof typeof GST_FINANCE_PROFILES] ?? 'Not recorded';
const utc = (date?: string | null) => date ? new Date(date).toISOString() : '';

const gstCsvMoney = (amount: number | null) => amount !== null && Number.isSafeInteger(amount)
  ? csvDecimal(rupees(amount)) : gstMoney(amount);

export function gstLedgerCsv(ledger: GstLedger, filters: GstFilters): string {
  const names = new Map(ledger.outlets.map(row => [row.id,row.name]));
  return toCsv([
    ['AutoDine internal GST reconciliation — not a GST return'], ['Scope',ledger.scope,'Selected outlet',ledger.outlet],
    ['Issue date range (India, inclusive)',filters.from,filters.through],
    ['FY',filters.fy,'Series',filters.series,'Buyer type',filters.audience,'Effective date',filters.effective,'Reference',filters.reference,'Profile',filters.profile,'Lifecycle',filters.status],
    ['Included outlet ID','Outlet name'], ...ledger.outlets.map(row => [row.id,row.name]), [],
    ['Blank values are not recorded or not applicable. Note amounts are unsigned and do not move money.'],
    ['Outlet ID','Outlet name','Document','Issue time (UTC)','Issue date (India)','FY','Series','Type','Billing registration','Buyer type','Lifecycle','IRP status','Activation date','Buyer GSTIN','Original document','Gross (INR)','Taxable (INR)','CGST (INR)','SGST (INR)','IGST (INR)','Paid at issue (INR)','Rounding delta (INR)','Profile','Rate (bps)','Profile version','Supplier GSTIN','Fulfilment','Document ID','Original ID','Original issue (UTC)','Supersedes document ID','Void time (UTC)'],
    ...ledger.documents.map((row) => [row.outlet_id,names.get(row.outlet_id) ?? '',row.number,utc(row.issued_at),localDateKey(RESTAURANT_TIME_ZONE,new Date(row.issued_at)),row.financial_year,row.series,row.kind,row.billing,row.audience,
      gstStatus(row),row.irp_status,row.effective_from ?? '',row.buyer_gstin ?? '',row.source_number ?? '',gstCsvMoney(row.gross),gstCsvMoney(row.taxable),
      gstCsvMoney(row.cgst),gstCsvMoney(row.sgst),gstCsvMoney(row.igst),gstCsvMoney(row.paid_at_issue),gstCsvMoney(row.rounding_delta),row.profile,row.rate_bps ?? '',row.profile_version ?? '',
      row.supplier_gstin ?? '',row.fulfilment ?? '',row.id,row.source_id ?? '',utc(row.source_issued_at),row.supersedes_invoice_id ?? '',utc(row.voided_at)]),
    [],['Document group totals (saved values; a blank aggregate for a tax head means at least one contributing value was not recorded)'],
    ['Outlet ID','FY','Series','Type','Profile','Rate (bps)','Buyer type','Lifecycle','IRP status','Document count','Rows without full tax values','Gross (INR)','Taxable (INR)','CGST (INR)','SGST (INR)','IGST (INR)','Rounding delta (INR)'],
    ...ledger.buckets.map(row => [row.outlet_id,row.financial_year,row.series,row.kind,row.profile,row.rate_bps ?? '',row.audience,gstStatus(row),row.irp_status,row.count,row.missing_tax_count,
      gstCsvMoney(row.gross_paise),gstCsvMoney(row.taxable_paise),gstCsvMoney(row.cgst_paise),gstCsvMoney(row.sgst_paise),gstCsvMoney(row.igst_paise),gstCsvMoney(row.rounding_delta_paise)]),
    [],[PAYMENTS_NOTE],['Outlet ID','Payment row status','Current link to billing','Count','Amount (INR)'],
    ...ledger.payments.map((row) => [row.outlet_id,row.status,row.linked_to,row.count,gstCsvMoney(row.amount_paise)]),
  ]);
}
