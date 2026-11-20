import { IRP_EVENT_LABELS, IRP_PHASES, type IrpPhase } from '@/lib/gst/irp/execution/presentation';

const notices:Record<string,string>={
  disabled:'Local simulation is disabled in this environment. No provider was contacted.',
  denied:'Only an entitled owner may request an IRP operation.', outlet:'The active outlet changed. Reload before requesting work.',
  invalid:'Invalid request. Reload this view and try again.', stale:'The status changed. Review the latest state before requesting work again.',
  rejected:'The request was not recorded. Check eligibility, routing, the current state and the time window.',
  saved:'Local route preference saved. No payload was sent.', queued:'Work recorded. No IRN or cancellation was issued by this action.',
};
export function IrpNotice({code}:{code:unknown}) {
  return typeof code==='string' && Object.hasOwn(notices,code)?<p role="status" className="rounded-[10px] border border-hair bg-card p-3 text-sm">{notices[code]}</p>:null;
}
export const phaseLabel=(phase:IrpPhase,tier:string, hasEvidence:boolean)=>phase==='accepted'&&!hasEvidence?'Recorded active state — evidence unavailable':tier==='simulation' && phase==='accepted'?'Verified simulation · legal hold remains'
  : tier==='simulation' && phase==='cancelled'?'Simulation cancellation confirmed':IRP_PHASES[phase];
export const eventLabel=(code:string)=>Object.hasOwn(IRP_EVENT_LABELS,code)?IRP_EVENT_LABELS[code]:'Status unavailable';
export function indiaTime(iso:string|null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(iso))+' IST';
}
