import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { syntheticGstin } from '../test-fixtures';
import { evaluateIrpMandate, reportingWindow } from '../applicability';
import { getIrpPreflightGate } from '../adapter';
import { buildIrpPayload } from './payload';
import { fingerprint } from './fingerprint';
import { mapInv01, validateInv01 } from './inv01';
import { advanceIrpJob, cancelIrpJob, documentIdentity, documentKey, isWithinCancellationWindow, validateNicAcknowledgement, verifiedJwsObject, type Inv01ProviderAdapter, type IrpJobStore, type ProviderJob } from './provider';

const party = { gstin: syntheticGstin('27ZZZZZ0000Z1Z'), legalName:'Synthetic Seller Kitchen', tradeName:null,
  address1:'1 Synthetic Test Lane',address2:null,location:'Synthetic City',pincode:'440001',stateCode:'27',email:null,phone:null };
const request = buildIrpPayload({ documentType:'INV',documentNumber:'I27/26-27/000001',issuedDate:'2026-11-19',
  seller:party,buyer:{...party,gstin:syntheticGstin('29YYYYY0000A1Z'),legalName:'Synthetic Buyer Inc',stateCode:'29',pincode:'560001'},
  supplyType:'B2B',placeOfSupplyStateCode:'27',lines:[{itemName:'Plate',quantity:3,unitPricePaise:3333,grossAmountPaise:10000,
    discountPaise:0,taxablePaise:10000,cgstPaise:250,sgstPaise:250,igstPaise:0,rateBps:500,totalItemValuePaise:10500}] });

function runtime() {
  const generate = vi.fn<Inv01ProviderAdapter['generate']>().mockResolvedValue({kind:'indeterminate'});
  const lookup = vi.fn<Inv01ProviderAdapter['lookup']>().mockResolvedValue({kind:'indeterminate'});
  const cancel = vi.fn<Inv01ProviderAdapter['cancel']>();
  const verifyAck = vi.fn().mockReturnValue(null);
  const adapter: Inv01ProviderAdapter = {id:'synthetic-test',environment:'provider_test',generate,lookup,cancel};
  let saved: ProviderJob | undefined;
  const store: IrpJobStore = { async reserve(input) { saved ??= input; return saved; },
    async compareAndSwap(previous,next) { if (previous !== saved) return false; saved = next; return true; } };
  const advance = (environment: 'provider_test'|'provider_live' = 'provider_test', deadlineMs?: number) => advanceIrpJob({
    payload:request,reportingCategory:'at_least_10cr',reportingDate:'2026-11-20',environment,adapter,store,verifyAck,deadlineMs,
  });
  return { generate,lookup,cancel,advance,verifyAck,store };
}

describe('IRP rules and official-field preflight', () => {
  const facts = {documentKind:'tax_invoice',issueDate:'2026-11-19',supply:'registered',highestPriorFyPaise:5_000_000_000,fullPanHistory:true} as const;
  it('requires full PAN history to clear and is conservative about exemptions', () => {
    expect(evaluateIrpMandate(facts)).toBe('not_required');
    expect(evaluateIrpMandate({...facts,fullPanHistory:false})).toBe('unknown');
    expect(evaluateIrpMandate({...facts,highestPriorFyPaise:5_000_000_001})).toBe('required');
    expect(evaluateIrpMandate({...facts,highestPriorFyPaise:null,fullPanHistory:false,knownPriorFyPaise:5_000_000_001})).toBe('required');
    expect(evaluateIrpMandate({...facts,entityExemption:{category:'government_department',verifiedForDate:false}})).toBe('unknown');
    expect(evaluateIrpMandate({...facts,entityExemption:{category:'government_department',verifiedForDate:true}})).toBe('not_required');
    expect(evaluateIrpMandate({...facts,supply:'sez_recipient',highestPriorFyPaise:6_000_000_000})).toBe('required');
  });
  it('enforces effective date, inclusive 30 calendar days, unknown category and real dates', () => {
    expect(reportingWindow('2025-04-01','2025-04-30','at_least_10cr')).toEqual({ok:true,lastDate:'2025-04-30'});
    expect(reportingWindow('2025-04-01','2025-05-01','at_least_10cr')).toMatchObject({code:'reporting_window_expired'});
    expect(reportingWindow('2025-04-01','2025-04-30','unknown')).toMatchObject({code:'unknown_window'});
    expect(reportingWindow('2025-02-31','2025-04-30','under_10cr')).toMatchObject({code:'invalid_date'});
    expect(reportingWindow('2025-03-01','2025-03-30','at_least_10cr')).toMatchObject({code:'unknown_window'});
  });
  it('validates the mapped identity, required service fields and integer reconciliation', () => {
    const wire = mapInv01(request);
    expect(validateInv01(wire)).toEqual([]);
    expect(wire.BuyerDtls).toMatchObject({Pos:'27',Stcd:'29'});
    expect(wire.DocDtls.No).toBe('I27/26-27/000001');
    expect(validateInv01({...wire,DocDtls:{...wire.DocDtls,No:'027/26-27/000001'}})).toContain('DocDtls');
    expect(validateInv01({...wire,BuyerDtls:{...wire.BuyerDtls,Pos:'29'}})).toContain('BuyerDtls.Pos must match direct premises');
    expect(validateInv01({...wire,ValDtls:{...wire.ValDtls,CgstVal:0}})).toContain('ValDtls');
    expect(validateInv01({...wire,DocDtls:{...wire.DocDtls,Typ:'DBN'}})).toContain('RefDtls.PrecDocDtls');
    expect(validateInv01({...wire,DocDtls:{...wire.DocDtls,Dt:'31/02/2026'}})).toContain('DocDtls');
  });
  it('gates offline use to explicit development/test and ignores provider credentials', () => {
    expect(getIrpPreflightGate({NODE_ENV:'test',AUTODINE_IRP_PROVIDER:'sandbox'}).ok).toBe(true);
    expect(getIrpPreflightGate({NODE_ENV:'test',VERCEL_ENV:'preview',AUTODINE_IRP_PROVIDER:'sandbox'}).ok).toBe(false);
    expect(getIrpPreflightGate({NODE_ENV:'production',AUTODINE_IRP_PROVIDER:'sandbox'}).ok).toBe(false);
    expect(getIrpPreflightGate({NODE_ENV:'development',AUTODINE_IRP_PROVIDER:'real'}).ok).toBe(false);
  });
});

describe('provider-independent dispatch state machine (no real transport)', () => {
  it('isolates environments and computes identity from saved seller, type and India FY', async () => {
    const run = runtime();
    await expect(run.advance('provider_live')).rejects.toThrow(/environment mismatch/);
    expect(run.generate).not.toHaveBeenCalled();
    expect(documentKey(request)).toBe(`${party.gstin}:2026:INV:I27/26-27/000001`);
  });
  it('claims one dispatch across concurrent workers and reconciles after an uncertain response', async () => {
    const run = runtime();
    await Promise.all([run.advance(),run.advance()]);
    expect(run.generate).toHaveBeenCalledTimes(1);
    expect(await run.advance()).toMatchObject({state:'reconcile'});
    expect(run.lookup).toHaveBeenCalledWith(documentIdentity(request),expect.any(AbortSignal));
    expect(run.generate).toHaveBeenCalledTimes(1);
    run.lookup.mockResolvedValueOnce({kind:'confirmed_absent'});
    expect(await run.advance()).toMatchObject({state:'retryable'});
    run.generate.mockResolvedValueOnce({kind:'rejected',code:'REGISTERED_DATA_INVALID'});
    expect(await run.advance()).toMatchObject({state:'rejected',issue:'provider_rejected',responseSha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
    await run.advance();
    expect(run.generate).toHaveBeenCalledTimes(2);
  });
  it('treats duplicate and unverified provider results as reconciliation, not success', async () => {
    const run = runtime();
    run.generate.mockResolvedValueOnce({kind:'duplicate'});
    expect(await run.advance()).toMatchObject({state:'reconcile',issue:'provider_duplicate'});
    run.lookup.mockResolvedValueOnce({kind:'found',body:{ status:'unverified' }});
    const next = await run.advance();
    expect(next).toMatchObject({state:'reconcile',issue:'unverified_lookup'});
    expect(next.acknowledgement).toBeUndefined();
    expect(run.generate).toHaveBeenCalledTimes(1);
  });
  it('refuses malformed, unsigned or unverified response structures', () => {
    const { publicKey } = generateKeyPairSync('rsa',{modulusLength:2048});
    expect(verifiedJwsObject('not.a.signature',publicKey)).toBeNull();
    expect(validateNicAcknowledgement({ AckNo: 'unchecked' },request,publicKey)).toBeNull();
  });
  it('bounds a non-returning transport and does not retry on indeterminate lookup', async () => {
    const run=runtime();
    run.generate.mockImplementationOnce(() => new Promise(() => {}));
    expect(await run.advance('provider_test',3)).toMatchObject({state:'reconcile',issue:'transport_uncertain'});
    expect(run.generate.mock.calls[0][2].aborted).toBe(true);
    expect(await run.advance('provider_test',3)).toMatchObject({state:'reconcile',issue:'lookup_indeterminate'});
    expect(run.generate).toHaveBeenCalledTimes(1);
  });
  it('ignores a late result behind a timed-out dispatch', async () => {
    const run=runtime();
    let reply:(value:Awaited<ReturnType<Inv01ProviderAdapter['generate']>>)=>void=()=>{};
    const late = new Promise<Awaited<ReturnType<Inv01ProviderAdapter['generate']>>>(resolve=>{reply=resolve;});
    run.generate.mockImplementationOnce(()=>late);
    const timedOut=await run.advance('provider_test',3);
    expect(timedOut).toMatchObject({state:'reconcile',issue:'transport_uncertain'});
    reply({kind:'rejected',code:'LATE_FIXTURE'});
    await late;
    expect(await run.store.reserve(timedOut,mapInv01(request))).toBe(timedOut);
    expect(run.generate).toHaveBeenCalledTimes(1);
  });
  it('checks the exact 24-hour edge and cannot cancel an unverified hold', async () => {
    const start = '2026-11-19T08:33:00.000+05:30';
    const at=Date.parse(start);
    expect(isWithinCancellationWindow(start,at-1)).toBe(false);
    expect(isWithinCancellationWindow(start,at+86_399_999)).toBe(true);
    expect(isWithinCancellationWindow(start,at+86_400_000)).toBe(false);
    const run=runtime(), job=await run.advance();
    await expect(cancelIrpJob({job,store:run.store,now:at,reason:'1',remark:'Synthetic reversal check',ewayBill:'unknown',adapter:{
      id:job.providerId,environment:'provider_test',generate:run.generate,lookup:run.lookup,cancel:run.cancel,
    }})).rejects.toThrow(/prerequisites/);
    expect(run.cancel).not.toHaveBeenCalled();
  });
  it('checks a pinned RSA signer with a non-invoice challenge; tampering or a different key fails', () => {
    const key=generateKeyPairSync('rsa',{modulusLength:2048});
    const other=generateKeyPairSync('rsa',{modulusLength:2048});
    const part=(data:object)=>Buffer.from(JSON.stringify(data)).toString('base64url');
    const body={purpose:'signature verifier self-test; not a GST document'};
    const protectedBody=`${part({alg:'RS256'})}.${part(body)}`;
    const signature=sign('RSA-SHA256',Buffer.from(protectedBody),key.privateKey).toString('base64url');
    expect(verifiedJwsObject(`${protectedBody}.${signature}`,key.publicKey)).toEqual(body);
    expect(verifiedJwsObject(`${protectedBody}.${signature}`,other.publicKey)).toBeNull();
    expect(verifiedJwsObject(`${protectedBody.split('.')[0]}.${part({different:true})}.${signature}`,key.publicKey)).toBeNull();
    expect(validateNicAcknowledgement({Status:'CNL'},request,key.publicKey)).toBeNull();
  });

  it('reconciles an uncertain cancellation only by cancellation lookup and never treats it as generation', async () => {
    const run=runtime();
    const ackAt='2026-11-19T08:33:00.000+05:30';
    const acknowledgement = {irn:'synthetic placeholder, not an IRN',acknowledgementNo:'test',acknowledgedAt:ackAt,signedInvoice:'test',signedQr:'test'};
    // Use a hypothetical verified state to exercise the control contract,
    // not to simulate regulatory acceptance or generate signed artifacts.
    const job:ProviderJob=await run.store.reserve({state:'verified',revision:3,environment:'provider_test',providerId:'synthetic-test',
      documentKey:documentKey(request),payloadSha256:fingerprint(mapInv01(request)),acknowledgement},mapInv01(request));
    const lookupCancellation=vi.fn<NonNullable<Inv01ProviderAdapter['lookupCancellation']>>().mockResolvedValue({kind:'indeterminate'});
    const adapter:Inv01ProviderAdapter={id:job.providerId,environment:'provider_test',generate:run.generate,lookup:run.lookup,cancel:run.cancel,lookupCancellation};
    const cancel=(ewayBill:'active'|'none')=>cancelIrpJob({job,adapter,store:run.store,now:Date.parse(ackAt)+1,reason:'1',remark:'Synthetic test',ewayBill});
    await expect(cancel('active')).rejects.toThrow(/prerequisites/);
    expect(run.cancel).not.toHaveBeenCalled();
    run.cancel.mockResolvedValue({kind:'indeterminate'});
    expect(await cancel('none')).toMatchObject({state:'reconcile',operation:'cancel',issue:'cancellation_uncertain'});
    const check=()=>advanceIrpJob({payload:request,reportingCategory:'under_10cr',reportingDate:'2026-11-19',environment:'provider_test',adapter,store:run.store,verifyAck:run.verifyAck});
    lookupCancellation.mockResolvedValueOnce({kind:'confirmed_cancelled',irn:'another placeholder',at:'2026-11-19T08:34:00+05:30'});
    expect(await check()).toMatchObject({state:'reconcile'});
    lookupCancellation.mockResolvedValueOnce({kind:'confirmed_cancelled',irn:acknowledgement.irn,at:'2026-11-20T08:33:00+05:30'});
    expect(await check()).toMatchObject({state:'reconcile'});
    lookupCancellation.mockResolvedValueOnce({kind:'confirmed_cancelled',irn:acknowledgement.irn,at:'2026-11-19T08:34:00+05:30'});
    expect(await check()).toMatchObject({state:'cancelled',operation:'cancel',result:'lookup'});
    expect(run.lookup).not.toHaveBeenCalled();
    expect(run.generate).not.toHaveBeenCalled();
    expect(run.cancel).toHaveBeenCalledTimes(1);
  });

});
