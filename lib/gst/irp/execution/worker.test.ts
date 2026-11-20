import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildIrpPayload } from '../payload';
import { toValidatedInv01, validateInv01 } from '../inv01';
import { assessPriorPanYears, explainIrpMandate, reportingWindow, type IrpFacts, IRP_RULE } from '../../applicability';
import { SYNTHETIC_BUYER, syntheticGstin } from '../../test-fixtures';
import { isLocalIrpSimulation } from '../../adapter';
import { IrpWorker } from './worker';
import { canCancelAt, indiaDay, signerId, verifyAcceptance } from './verification';
import { simulationAdapter, type SimRegistration } from './simulator';
import type { Claim, ExecutionStore, ProviderSession } from './contracts';

const sellerGstin=syntheticGstin('27ZZPRQ0001Z1Z');
const build=(now:number)=>{
  const issuedDate=indiaDay(now);
  const party={legalName:'Synthetic Issuer',tradeName:null,address1:'1 Test Lane',address2:null,location:'Nagpur',phone:null,email:null};
  return toValidatedInv01(buildIrpPayload({documentType:'INV',documentNumber:'INV/26-27/000001',issuedDate,
    seller:{...party,gstin:sellerGstin,pincode:'440001',stateCode:'27'},
    buyer:{...party,gstin:SYNTHETIC_BUYER,pincode:'560001',stateCode:'29'},placeOfSupplyStateCode:'27',supplyType:'B2B',
    lines:[{itemName:'Synthetic meal',hsnSac:'996331',quantity:1,unitPricePaise:10000,grossAmountPaise:10000,
      discountPaise:0,taxablePaise:10000,cgstPaise:250,sgstPaise:250,igstPaise:0,rateBps:500,totalItemValuePaise:10500}],
  }));
};
const now=Date.parse('2026-11-18T12:00:00Z');
let keys:ReturnType<typeof rsa>;
const rsa=()=>generateKeyPairSync('rsa',{modulusLength:2048});
beforeAll(()=>{keys=rsa();});
const claim=(overrides:Partial<Claim>={}):Claim=>({id:'local',outlet:'sim-kitchen',routeId:'route',token:'lease',operation:'generate',
  documentKey:`${sellerGstin}:2026:INV:INV/26-27/000001`,request:build(now),seller:sellerGstin,provider:'sim-local',apiVersion:'synthetic-1',
  schemaVersion:'1.1',tier:'simulation',signerFingerprint:signerId(keys.publicKey),leaseUntil:new Date(Date.now()+30_000).toISOString(),
  reportingDeadline:null,reason:null,reference:null,acknowledgedAt:null,...overrides});
function adapter() {
  const rows=new Map<string,SimRegistration>();
  return simulationAdapter({keyPair:keys,registry:{
    async findByKey(key){return rows.get(key)??null;},
    async findByReference(ref){return [...rows.values()].find(r=>r.reference===ref)??null;},
    async insertIfAbsent(e){if(rows.has(e.documentKey))return false;rows.set(e.documentKey,e);return true;},
    async cancelUnlessCancelled(ref,at){const doc=[...rows.values()].find(r=>r.reference===ref); if(!doc||doc.cancelledAt)return null;
      const result={...doc,cancelledAt:at};rows.set(doc.documentKey,result);return result;},
  }});
}
const scope={outlet:'sim-kitchen',seller:sellerGstin,provider:'sim-local',tier:'simulation' as const};
const cts = ()=>new AbortController().signal;
async function simulatedResponse(c:Claim) {
  const s=await adapter().open(scope,cts());
  const r=await s.generate(c.request,c.documentKey,cts());
  if (r.kind!=='accepted') throw new Error('Expected simulation envelope');
  return r.body as Record<string,unknown>;
}
function store(c:Claim){return {async claim(){return c;},async sweep(){return 0;},finish:vi.fn(async()=>true)} satisfies ExecutionStore;}

describe('IRP policy and transport boundary',()=>{
  const input:IrpFacts={documentKind:'tax_invoice',issueDate:'2026-11-18',supply:'registered',highestPriorFyPaise:5_000_000_000,fullPanHistory:true};
  it('documents effective Rule 48 boundary and strict exceedance, distinct from the inclusive reporting threshold',()=>{
    expect(explainIrpMandate(input)).toMatchObject({rule:IRP_RULE,mandate:'not_required',reason:'prior_pan_at_or_below_limit'});
    expect(explainIrpMandate({...input,highestPriorFyPaise:5_000_000_001})).toMatchObject({mandate:'required',routeScope:'domestic_subset'});
    expect(explainIrpMandate({...input,issueDate:'2023-07-31'})).toMatchObject({mandate:'unknown',reason:'unreviewed_date'});
    expect(explainIrpMandate({...input,issueDate:'2023-08-01'}).mandate).toBe('not_required');
    expect(reportingWindow('2025-04-01','2025-04-30','at_least_10cr')).toEqual({ok:true,lastDate:'2025-04-30'});
    expect(reportingWindow('2025-04-01','2025-05-01','under_10cr')).toEqual({ok:true,lastDate:null});
  });
  it('reviews prior years by PAN, not turnover sum/current FY; preserves a known high prior year under partial review',()=>{
    const years=Array.from({length:9},(_,i)=>({fyStart:2017+i,paise:i===0?6_000_000_000:3_100_000_000}));
    const facts=assessPriorPanYears(input.issueDate,years);
    expect(facts).toEqual({knownPriorFyPaise:6_000_000_000,highestPriorFyPaise:6_000_000_000,fullPanHistory:true});
    expect(explainIrpMandate({...input,...assessPriorPanYears(input.issueDate,years.slice(0,2))}).mandate).toBe('required');
    expect(explainIrpMandate({...input,...assessPriorPanYears(input.issueDate,years.slice(1))}).mandate).toBe('unknown');
    expect(assessPriorPanYears(input.issueDate,[...years,{fyStart:2026,paise:10_000_000_000}]).fullPanHistory).toBe(false);
    expect(assessPriorPanYears(input.issueDate,[...years,years[0]]).knownPriorFyPaise).toBeNull();
  });
  it('does not reinterpret export / SEZ buyer, B2C, Bill of Supply, or unverified supplier exemptions',()=>{
    const high={...input,highestPriorFyPaise:12_000_000_000};
    for (const supply of ['export','sez_recipient'] as const) expect(explainIrpMandate({...high,supply})).toMatchObject({mandate:'required',routeScope:'unsupported_supply'});
    expect(explainIrpMandate({...high,supply:'consumer'}).reason).toBe('consumer');
    expect(explainIrpMandate({...high,documentKind:'bill_of_supply'}).reason).toBe('not_tax_document');
    expect(explainIrpMandate({...high,entityExemption:{category:'government_department',verifiedForDate:false}}).routeScope).toBe('hold');
    expect(explainIrpMandate({...high,entityExemption:{category:'rule54_2_3_4_4a',verifiedForDate:true}}).reason).toBe('supplier_exemption');
  });
  it('enables local controls only on an explicitly opted-in loopback backend and never a deployed runtime',()=>{
    const env:NodeJS.ProcessEnv={NODE_ENV:'test',VERCEL_ENV:'test',AUTODINE_IRP_PROVIDER:'sandbox',AUTODINE_IRP_SIMULATION:'true',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:3118'};
    expect(isLocalIrpSimulation(env)).toBe(true);
    const patches:Partial<NodeJS.ProcessEnv>[]=[{VERCEL_ENV:'preview'},{NODE_ENV:'production'},{AUTODINE_IRP_SIMULATION:''},{AUTODINE_IRP_PROVIDER:'other'},
      {NEXT_PUBLIC_SUPABASE_URL:'https://not-loopback.invalid'},{NEXT_PUBLIC_SUPABASE_URL:'http://localhost@not-loopback.invalid'}];
    for (const patch of patches) {
      expect(isLocalIrpSimulation({...env,...patch})).toBe(false);
    }
  });
  it('rejects fractional paise, non-domestic transactions, and a lone GST status string',()=>{
    const request=build(now);
    expect(validateInv01(request)).toEqual([]);
    expect(validateInv01({...request,ValDtls:{...request.ValDtls,TotInvVal:105.0001}})).toContain('ValDtls');
    expect(validateInv01({...request,TranDtls:{...request.TranDtls,SupTyp:'EXPWOP'}})).toContain('TranDtls');
    expect(verifyAcceptance({status:'active'},claim(),keys.publicKey,now)).toBeNull();
  });
  it('pins both signatures, tier, receipt time, number and document before marking a response verified',async()=>{
    const c=claim(), body=await simulatedResponse(c);
    expect(verifyAcceptance(body,c,keys.publicKey,Date.now())).toMatchObject({reference:expect.stringMatching(/^SIM-/)});
    for (const bad of [{...body,tier:'authority'},{...body,ackNumber:'0'},{...body,ackAt:'2026-02-31T01:00:00Z'},{...body,status:'cancelled'}]) {
      expect(verifyAcceptance(bad,c,keys.publicKey,Date.now())).toBeNull();
    }
    expect(verifyAcceptance(body,c,rsa().publicKey,Date.now())).toBeNull();
    expect(verifyAcceptance(body,{...c,tier:'authority'},keys.publicKey,Date.now())).toBeNull();
    expect(verifyAcceptance(body,c,keys.publicKey,Date.now()-120_000)).toBeNull();
    expect(verifyAcceptance(body,{...c,reportingDeadline:'2026-11-17'},keys.publicKey,Date.now())).toBeNull();
  });
  it('aborts transport at the local deadline and ignores completion when a timed-out adapter returns late',async()=>{
    const c=claim(), s=store(c), a=adapter();
    let signal:AbortSignal|undefined;
    let release:((r:Awaited<ReturnType<ProviderSession['generate']>>)=>void)|undefined;
    const realOpen=a.open.bind(a);
    a.open=async (scope, abort)=>({...await realOpen(scope,abort),generate:(_r,_k,active)=>{
      signal=active;
      return new Promise(resolve=>{release=resolve;});
    }});
    expect(await new IrpWorker(s,[a],10).one(c.outlet,'route')).toBe('recorded');
    expect(signal?.aborted).toBe(true);
    expect(s.finish).toHaveBeenCalledOnce();
    expect(s.finish).toHaveBeenCalledWith(c,{code:'uncertain'},expect.any(Number));
    release?.({kind:'accepted',body:await simulatedResponse(c)});
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(s.finish).toHaveBeenCalledOnce();
  });
  it('makes no transport request when provider pins or authority environment do not match',async()=>{
    const a=adapter(), open=vi.spyOn(a,'open');
    const wrong=claim({apiVersion:'not-approved'}), p=store(wrong);
    expect(await new IrpWorker(p,[a]).one(wrong.outlet,'route')).toBe('recorded');
    expect(p.finish).toHaveBeenCalledWith(wrong,{code:'not_sent'},expect.any(Number));
    const auth=claim({tier:'authority'}), t=store(auth);
    expect(await new IrpWorker(t,[a]).one(auth.outlet,'route')).toBe('stale');
    expect(t.finish).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('uses strict cancellation time and does not trust an unrelated absence response',async()=>{
    const ack='2026-11-18T12:00:00+05:30', t=Date.parse(ack);
    expect(canCancelAt(ack,t-1)).toBe(false);
    expect(canCancelAt(ack,t+86_399_999)).toBe(true);
    expect(canCancelAt(ack,t+86_400_000)).toBe(false);
    expect(canCancelAt('2026-11-18 12:00:00',now)).toBe(false);
    const c=claim({operation:'lookup'}), s=store(c), a=adapter(), realOpen=a.open.bind(a);
    a.open=async (scope, signal)=>({...await realOpen(scope,signal),async lookup(){return {kind:'absent',documentKey:'not-this-source'};}});
    await new IrpWorker(s,[a]).one(c.outlet,'route');
    expect(s.finish).toHaveBeenCalledWith(c,{code:'uncertain'},expect.any(Number));
  });
});
