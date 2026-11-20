/** Disconnected test transport. IDs intentionally cannot pass legal IRN/ACK
 * patterns; signed JSON carries Simulation=true. Nothing reads env or network. */
import { randomUUID, sign, type KeyObject } from 'node:crypto';
import type { Inv01 } from '../inv01';
import type { ProviderAdapter } from './contracts';

export type SimRegistration = { documentKey: string; reference: string; ackNumber: string; ackAt: string;
  signedInvoice: string; signedQr: string; cancelledAt: string | null };
export interface SimulationRegistry {
  findByKey(documentKey: string): Promise<SimRegistration | null>;
  findByReference(reference: string): Promise<SimRegistration | null>;
  insertIfAbsent(entry: SimRegistration): Promise<boolean>;
  cancelUnlessCancelled(reference: string, at: string): Promise<SimRegistration | null>;
}
type SimulationBehavior = {
  generate?: 'declined' | 'not_sent' | 'unknown' | 'accept_then_timeout' | 'bad_signature' | 'wrong_document' | 'wrong_qr';
  lookup?: 'unknown';
  cancel?: 'declined' | 'not_sent' | 'unknown' | 'cancel_then_timeout' | 'wrong_reference';
  ewayBill?: 'none' | 'active' | 'cancelled' | 'unknown';
};
function signed(body: unknown, privateKey: KeyObject) {
  const input = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
  return `${input}.${sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url')}`;
}
const active = (entry: SimRegistration) => ({ kind: 'accepted' as const, body: {
  status:'active',tier:'simulation',reference:entry.reference,ackNumber:entry.ackNumber,ackAt:entry.ackAt,
  signedInvoice:entry.signedInvoice,signedQr:entry.signedQr,
}});

export function simulationAdapter(options: {
  registry: SimulationRegistry; keyPair: { privateKey: KeyObject; publicKey: KeyObject }; behavior?: SimulationBehavior;
}): ProviderAdapter {
  const {registry,keyPair,behavior={}}=options;
  return {
    key:'sim-local',tier:'simulation',apiVersion:'synthetic-1',schemaVersions:['1.1'],signingPublicKey:keyPair.publicKey,
    capabilities:{operations:['generate','lookup','cancel','lookup_cancel'],domesticServices:true,security:'isolated-simulator'},
    async open(scope,signal) {
      signal.throwIfAborted();
      if (scope.tier!=='simulation' || scope.provider!=='sim-local') throw new Error('Simulation scope does not match');
      const inScope=(key:string) => key.startsWith(`${scope.seller}:`);
      return {
        async generate(request: Inv01,key,s) {
          s.throwIfAborted();
          if (request.SellerDtls.Gstin!==scope.seller || !inScope(key)) return {kind:'declined'};
          if (behavior.generate==='declined' || behavior.generate==='not_sent' || behavior.generate==='unknown') return {kind:behavior.generate};
          const ref=`SIM-${randomUUID()}`, ackNumber=`SIM-ACK-${randomUUID()}`, ackAt=new Date().toISOString();
          const qr={Simulation:true,Irn:ref,SellerGstin:request.SellerDtls.Gstin,BuyerGstin:request.BuyerDtls.Gstin,
            DocNo:request.DocDtls.No,DocDt:request.DocDtls.Dt,DocTyp:request.DocDtls.Typ,TotInvVal:request.ValDtls.TotInvVal,
            ItemCnt:request.ItemList.length,MainHsnCode:request.ItemList[0].HsnCd};
          const entry: SimRegistration={documentKey:key,reference:ref,ackNumber,ackAt,cancelledAt:null,
            signedInvoice:signed({ ...request, Simulation:true,Irn:ref,AckNo:ackNumber,AckDt:ackAt },keyPair.privateKey),
            signedQr:signed(qr,keyPair.privateKey)};
          if (!await registry.insertIfAbsent(entry)) return {kind:'duplicate'};
          if (behavior.generate==='accept_then_timeout') return {kind:'unknown'};
          if (behavior.generate==='bad_signature') return active({...entry,signedQr:entry.signedQr.replace(/\.[^.]+$/,'.dGVzdA')});
          if (behavior.generate==='wrong_document') return active({...entry,signedInvoice:signed({ ...request, DocDtls:{...request.DocDtls,No:'WRONG'},
            Simulation:true,Irn:ref,AckNo:ackNumber,AckDt:ackAt },keyPair.privateKey)});
          if (behavior.generate==='wrong_qr') return active({...entry,signedQr:signed({...qr,TotInvVal:0},keyPair.privateKey)});
          return active(entry);
        },
        async lookup(key,s) {
          s.throwIfAborted();
          if (!inScope(key) || behavior.lookup==='unknown') return {kind:'unknown'};
          const doc=await registry.findByKey(key);
          return doc ? doc.cancelledAt ? {kind:'unknown'} : active(doc) : {kind:'absent',documentKey:key};
        },
        async ewayBill(reference,s) {
          s.throwIfAborted();
          const doc=await registry.findByReference(reference);
          return doc && inScope(doc.documentKey) ? behavior.ewayBill??'none':'unknown';
        },
        async cancel(reference,_reason,_remark,requestKey,s) {
          s.throwIfAborted();
          const doc=await registry.findByReference(reference);
          if (!doc || !inScope(doc.documentKey) || requestKey!==`${doc.documentKey}:cancel`) return {kind:'declined'};
          if (behavior.cancel==='declined' || behavior.cancel==='not_sent' || behavior.cancel==='unknown') return {kind:behavior.cancel};
          const result=await registry.cancelUnlessCancelled(reference,new Date().toISOString());
          if (!result?.cancelledAt || behavior.cancel==='cancel_then_timeout') return {kind:'unknown'};
          return {kind:'cancelled',evidence:{reference:behavior.cancel==='wrong_reference'?`SIM-${randomUUID()}`:result.reference,at:result.cancelledAt}};
        },
        async lookupCancellation(key,reference,s) {
          s.throwIfAborted();
          if (!inScope(key) || behavior.lookup==='unknown') return {kind:'unknown'};
          const doc=await registry.findByKey(key);
          if (!doc || doc.reference!==reference) return {kind:'unknown'};
          return doc.cancelledAt ? {kind:'cancelled',evidence:{reference,at:doc.cancelledAt}} : {kind:'active',documentKey:key,reference};
        },
      };
    },
  };
}
