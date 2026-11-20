import { validateInv01 } from '../inv01';
import { gstFinancialYearStart } from '../../onboarding';
import { IRP_CANCEL_REASONS } from '../types';
import { fingerprint } from '../fingerprint';
import type { Claim, ExecutionStore, Outcome, ProviderAdapter } from './contracts';
import { canCancelAt, indiaDay, instant, object, signerId, verifyAcceptance, verifyCancellation } from './verification';

/** The application never resolves a runtime network adapter. An approved
 * worker supplies its registry explicitly; unregistered routes fail closed. */
export class IrpWorker {
  constructor(private readonly store: ExecutionStore, private readonly adapters: readonly ProviderAdapter[],
    private readonly deadlineMs = 10_000) {
    if (!Number.isInteger(deadlineMs) || deadlineMs<1 || deadlineMs>30_000) throw new RangeError('Invalid IRP transport deadline');
  }
  async one(outlet: string, route: string, job?: string): Promise<'idle' | 'recorded' | 'stale'> {
    await this.store.sweep(outlet,route);
    const claim=await this.store.claim(outlet,route,job);
    // The verified store, routes and runtime are intentionally simulation-only.
    // An independent approval and compatibility exercise must precede enabling authority.
    if (!claim) return 'idle';
    if (claim.tier!=='simulation' || claim.outlet!==outlet || claim.routeId!==route || (job!==undefined && claim.id!==job)) return 'stale';
    const started=performance.now();
    const remaining=instant(claim.leaseUntil)-Date.now()-1000;
    if (!Number.isFinite(remaining) || remaining<=0) return 'stale';
    const controller=new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: Outcome;
    try {
      result=await Promise.race([
        this.execute(claim,controller.signal).catch(():Outcome=>({code:'uncertain'})),
        new Promise<Outcome>(resolve=>{ timer=setTimeout(()=>{ controller.abort(); resolve({code:'uncertain'}); },Math.min(this.deadlineMs,remaining)); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
    return await this.store.finish(claim,result,Math.min(60_000,Math.max(0,Math.round(performance.now()-started)))) ? 'recorded':'stale';
  }
  private async execute(claim: Claim, signal:AbortSignal):Promise<Outcome> {
    const { request,operation }=claim;
    const adapter=this.adapters.find(x=>x.key===claim.provider && x.apiVersion===claim.apiVersion && x.tier===claim.tier
      && x.schemaVersions.includes(claim.schemaVersion) && x.capabilities.operations.includes(operation) && x.capabilities.domesticServices
      && signerId(x.signingPublicKey)===claim.signerFingerprint && x.capabilities.security===(claim.tier==='authority'?'authenticated-provider':'isolated-simulator'));
    const verifyRequest=() => {
      if (validateInv01(request).length || request.Version!==claim.schemaVersion) return false;
      const {Dt,Typ,No}=request.DocDtls, date=Dt.split('/').reverse().join('-');
      return claim.seller===request.SellerDtls.Gstin && claim.documentKey===`${claim.seller}:${gstFinancialYearStart(date)}:${Typ}:${No}`;
    };
    if (!verifyRequest()) return {code: operation==='generate'?'invalid_request':'invalid_reply'};
    if (!adapter) return {code:operation==='generate'||operation==='cancel'?'not_sent':'uncertain'};
    const session=await adapter.open({outlet:claim.outlet,seller:claim.seller,provider:claim.provider,tier:claim.tier},signal);
    signal.throwIfAborted();
    const acceptance=(body:unknown):Outcome=>{
      const evidence=verifyAcceptance(body,claim,adapter.signingPublicKey,Date.now());
      return evidence ? {code:'verified',evidence,digest:fingerprint(evidence)}:{code:'invalid_reply'};
    };
    if (operation==='generate') {
      if (claim.reportingDeadline && indiaDay(Date.now())>claim.reportingDeadline) return {code:'not_sent'};
      const reply=await session.generate(request,claim.documentKey,signal);
      if (reply.kind==='accepted') return acceptance(reply.body);
      return {code:reply.kind==='declined'||reply.kind==='duplicate'||reply.kind==='not_sent'?reply.kind:'uncertain'};
    }
    if (operation==='lookup') {
      const reply=await session.lookup(claim.documentKey,signal);
      return reply.kind==='accepted' ? acceptance(reply.body):{code:reply.kind==='absent' && reply.documentKey===claim.documentKey?'confirmed_absent':'uncertain'};
    }
    const ref=claim.reference;
    if (!ref) return {code:'invalid_reply'};
    const cancelOutcome=(e:unknown):Outcome=>{
      const verified=verifyCancellation(e,claim,Date.now());
      return verified?{code:'cancelled',evidence:verified,digest:fingerprint(verified)}:{code:'invalid_reply'};
    };
    if (operation==='lookup_cancel') {
      const reply=await session.lookupCancellation(claim.documentKey,ref,signal);
      return reply.kind==='cancelled' ? cancelOutcome(reply.evidence):{code:reply.kind==='active' && reply.documentKey===claim.documentKey && reply.reference===ref?'confirmed_active':'uncertain'};
    }
    if (!claim.reason || !Object.hasOwn(IRP_CANCEL_REASONS,claim.reason) || !canCancelAt(claim.acknowledgedAt,Date.now())) return {code:'cancel_blocked'};
    const status=await session.ewayBill(ref,signal);
    signal.throwIfAborted();
    if (!claim.reason || !canCancelAt(claim.acknowledgedAt,Date.now()) || !['none','cancelled'].includes(status)) return {code:'cancel_blocked'};
    const reply=await session.cancel(ref,claim.reason,IRP_CANCEL_REASONS[claim.reason],`${claim.documentKey}:cancel`,signal);
    if (reply.kind==='cancelled') return cancelOutcome(reply.evidence);
    return {code:reply.kind==='declined'||reply.kind==='not_sent'?reply.kind:'uncertain'};
  }
}

export type WorkerQuery = (sql: string, parameters: unknown[]) => Promise<unknown>;
/** This port needs a dedicated, private SQL principal; never a PostgREST
 * client or service-role string. Tests inject bound disposable connections. */
export function postgresExecutionStore(query: WorkerQuery): ExecutionStore {
  return {
    async claim(outlet,route,job) {
      const found=await query('select public.claim_irp_dispatch($1,$2,$3) as value',[outlet,route,job??null]);
      return found && typeof object(found).token==='string' ? found as Claim : null;
    },
    async sweep(outlet,route) { return Number(await query('select public.sweep_irp_leases($1,$2) as value',[outlet,route])); },
    async finish(claim,outcome,latencyMs) {
      return await query('select public.finish_irp_dispatch($1,$2,$3,$4,$5,$6) as value',[
        claim.id,claim.token,outcome.code,latencyMs,outcome.digest??null,outcome.evidence?JSON.stringify(outcome.evidence):null,
      ])===true;
    },
  };
}
