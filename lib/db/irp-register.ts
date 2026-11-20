import type { StaffContext } from './staff';
import { GST_UUID } from '@/lib/gst/buyer';
import { addBillingDays, gstFinancialYearStart, validIndianBillingDate } from '@/lib/gst/onboarding';
import { IRP_PHASES, type IrpPhase } from '@/lib/gst/irp/execution/presentation';
import { object, instant } from '@/lib/gst/irp/execution/verification';
import type { Tier } from '@/lib/gst/irp/execution/contracts';

export type IrpFilters = { from?: string; to?: string; followup: boolean; page: number };
export const IRP_PAGE_SIZE = 100;
export function parseIrpFilters(params: URLSearchParams): IrpFilters | null {
  const from=params.get('from')||'', to=params.get('to')||'', followup=params.get('queue'), page=params.get('page')||'1';
  if ((from || to) && (!validIndianBillingDate(from) || !validIndianBillingDate(to) || to<from || to>addBillingDays(from,365))) return null;
  if ((followup!==null && followup!=='1') || !/^[1-9][0-9]{0,4}$/.test(page) || Number(page)>10_001) return null;
  return { ...(from?{from,to}:{}), followup:followup==='1', page:Number(page) };
}
export function irpFilterParams(filters: IrpFilters, page = filters.page): URLSearchParams {
  const params=new URLSearchParams();
  if (filters.from && filters.to) { params.set('from',filters.from); params.set('to',filters.to); }
  if (filters.followup) params.set('queue','1');
  if (page>1) params.set('page',String(page));
  return params;
}
export const IRP_REGISTER_PATH = '/dashboard/reports/irp';
export const irpSourcePath = (kind:'invoice'|'note', id:string) => kind==='invoice'?`/invoice/${id}`:`/dashboard/invoices/notes/${id}`;
const text = (value: unknown) => typeof value==='string'?value:'';
const isUuid = (value:unknown):value is string => typeof value==='string'&&GST_UUID.test(value);
const time = (value:unknown):string|null => typeof value==='string'&&Number.isFinite(instant(value))?value:null;
const day = (value:unknown):string|null => typeof value==='string'&&validIndianBillingDate(value)?value:null;
const count = (value:unknown):number => typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;
const phase = (value:unknown):value is IrpPhase => typeof value==='string'&&Object.hasOwn(IRP_PHASES,value);
const tier = (value:unknown):value is Tier => value==='simulation'||value==='authority';
const kind = (value:unknown):value is 'invoice'|'note' => value==='invoice'||value==='note';
const map = <T>(data:unknown, parse:(x:Record<string,unknown>)=>T|null):T[] => Array.isArray(data)?data.flatMap(x=>parse(object(x))??[]):[];

export type IrpRegisterRow = NonNullable<ReturnType<typeof parseRow>>;
function parseRow(r: Record<string,unknown>) {
  if (!isUuid(r.id) || !isUuid(r.document_id) || !phase(r.phase) || !tier(r.tier) || !kind(r.kind) || !day(r.issue_date)) return null;
  return { id:r.id, documentId:r.document_id, kind:r.kind, number:text(r.number), phase:r.phase,tier:r.tier,
    verifiedActive:r.verified_active===true&&r.phase==='accepted', routeAvailable:r.route_available===true, routeSelected:r.route_selected===true,
    revision:count(r.revision), provider:text(r.provider_key??r.provider), apiVersion:text(r.api_version), schemaVersion:text(r.schema_version),
    issueDate:text(r.issue_date),deadline:day(r.reporting_deadline), category:text(r.reporting_category),rule:text(r.rule_version),
    nextAt:time(r.next_action_at), createdAt:time(r.created_at), updatedAt:time(r.updated_at), lastCode:text(r.last_code),
    generationAttempts:count(r.generation_attempts), cancellationAttempts:count(r.cancellation_attempts), lookupAttempts:count(r.lookup_attempts),
  };
}
export function parseIrpRegister(data: unknown, outlet: string) {
  const r=object(data), asOf=day(r.as_of_india), routing=object(r.routing), e=object(r.eligibility);
  if (r.outlet!==outlet || !asOf || !Array.isArray(r.rows) || typeof r.total!=='number' || count(r.total)!==r.total) return null;
  const rows=map(r.rows,parseRow);
  if (rows.length!==r.rows.length || rows.length>r.total) return null;
  const currentFy=gstFinancialYearStart(asOf);
  const decision=e.mandate==='required'||e.mandate==='not_required'?e.mandate:'unknown';
  return {outlet,asOf,total:r.total,rows,verifiedAuthority:count(r.verified_authority),verifiedSimulation:count(r.verified_simulation),
    missingCount:count(r.missing_count),
    routing:{id:isUuid(routing.route)?routing.route:null,revision:count(routing.revision),available:routing.available===true},
    eligibility:{mode:text(e.mode),fy:count(e.review_fy)||null,currentFy,category:text(e.reporting_category),
      version:count(e.version)||null,decision},
    routes:map(r.routes, x=>isUuid(x.id)&&tier(x.tier)?{id:x.id,tier:x.tier,provider:text(x.provider), apiVersion:text(x.api_version), schema:text(x.schema_version)}:null),
    drafts:map(r.drafts, x=>isUuid(x.id)&&isUuid(x.document_id)&&kind(x.kind)?{id:x.id,documentId:x.document_id,kind:x.kind,number:text(x.number),
      version:text(x.payload_version), recordedAt:time(x.created_at)}:null),
    missing:map(r.missing, x=>isUuid(x.document_id)&&kind(x.kind)?{documentId:x.document_id,kind:x.kind,number:text(x.number),
      applicability:text(x.applicability)}:null),
    phases:map(r.breakdown, x=>tier(x.tier)&&phase(x.phase)?{tier:x.tier,phase:x.phase,count:count(x.count)}:null),
    providers:map(r.providers, x=>tier(x.tier)?{tier:x.tier,provider:text(x.provider_key),version:text(x.api_version),
      completions:count(x.calls),failures:count(x.failures),mean:x.latency_mean_ms===null?null:count(x.latency_mean_ms),max:x.latency_max_ms===null?null:count(x.latency_max_ms)}:null),
  };
}
export async function loadIrpRegister(staff:StaffContext, filters:IrpFilters, exporting=false) {
  const {data,error}=await staff.supabase.rpc('report_irp_register',{p_outlet:staff.restaurantId,
    p_limit:exporting?10_000:IRP_PAGE_SIZE, p_offset:exporting?0:(filters.page-1)*IRP_PAGE_SIZE,p_followup:filters.followup,
    ...(filters.from && filters.to?{p_from:filters.from,p_until:addBillingDays(filters.to,1)}:{})});
  return error?null:parseIrpRegister(data,staff.restaurantId);
}
export function parseIrpCopy(data:unknown) {
  const c=object(data);
  if (!tier(c.tier) || !time(c.at) || typeof c.reference!=='string' || typeof c.number!=='string'
    || typeof c.qr!=='string' || c.qr.length>2400 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(c.qr)) return null;
  const correct=c.tier==='authority'?/^[a-f0-9]{64}$/.test(c.reference)&&/^[1-9][0-9]{0,29}$/.test(c.number)
    : /^SIM-[a-f0-9-]{36}$/.test(c.reference)&&/^SIM-ACK-[a-f0-9-]{36}$/.test(c.number);
  return correct?{tier:c.tier,reference:c.reference,acknowledgement:c.number,acknowledgedAt:text(c.at),qr:c.qr}:null;
}
export async function loadIrpDispatch(staff:StaffContext, id:string) {
  const {data,error}=await staff.supabase.rpc('read_irp_dispatch',{p_outlet:staff.restaurantId,p_job:id});
  const d=object(data), parsed=error||d.id!==id?null:parseRow(d);
  if (!parsed) return null;
  const copy=parsed.phase==='accepted'?parseIrpCopy(d.copy):null;
  return {...parsed, copy:copy?.tier===parsed.tier?copy:null,cancelledAt:time(d.cancelled_at),cancelReason:text(d.cancel_reason),
    events:map(d.events, e=>phase(e.phase)&&time(e.at)?{rev:count(e.revision),phase:e.phase,code:text(e.code),at:text(e.at),reasonCode:text(e.reason_code),
      latency:e.latency_ms===null?null:count(e.latency_ms),digest:/^[a-f0-9]{64}$/.test(text(e.response_sha256))?text(e.response_sha256):null}:null)};
}
export function irpRegisterCsv(rows: readonly IrpRegisterRow[]): string {
  const csvCell=(x:string|number|null)=>{
    const value=x===null?'':String(x);
    return `"${(/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(value)?`'${value}`:value).replace(/"/g,'""')}"`;
  };
  return [
    ['dispatch_id','source','document_number','document_date_india','tier','phase','verified_active','reporting_category','deadline_india',
      'mandate_rule','provider','api_version','generate_claims','lookup_claims','cancel_claims','last_event','queued_at','last_activity_at'],
    ...rows.map(r=>[r.id,r.kind,r.number,r.issueDate,r.tier,r.phase,r.verifiedActive?'yes':'no',r.category,r.deadline,r.rule,r.provider,r.apiVersion,
      r.generationAttempts,r.lookupAttempts,r.cancellationAttempts,r.lastCode,r.createdAt,r.updatedAt]),
  ].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
