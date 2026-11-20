import { createHash, type KeyObject } from 'node:crypto';
import { verifiedJwsObject } from '../provider';
import { validIndianBillingDate } from '../../onboarding';
import { fingerprint } from '../fingerprint';
import type { AcceptedEvidence, CancelEvidence, Claim } from './contracts';

export const object = (value:unknown): Record<string,unknown> => value !== null && typeof value==='object' && !Array.isArray(value)
  ? value as Record<string,unknown> : {};
export function signerId(key: KeyObject): string {
  if (key.type !== 'public' || key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0)<2048) return '';
  return createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
}
export function instant(value: unknown): number {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
    && validIndianBillingDate(value.slice(0,10)) ? Date.parse(value) : NaN;
}
export function indiaDay(epoch: number) {
  return Number.isFinite(epoch) ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(epoch) : '';
}
function embedded(data: Record<string,unknown> | null) {
  if (typeof data?.data!=='string') return data;
  try { return object(JSON.parse(data.data)); } catch { return null; }
}
/** The adapter normalizes envelope/time/version from authenticated transport.
 * Both signed bodies are independently verified against the approved signer.
 * Simulation claims use an explicit marker and cannot pass authority syntax. */
export function verifyAcceptance(body: unknown, claim: Claim, key: KeyObject, now: number): AcceptedEvidence | null {
  const x=object(body), {reference,ackNumber,ackAt,signedInvoice,signedQr}=x;
  if (x.status!=='active' || x.tier!==claim.tier || typeof reference!=='string' || typeof ackNumber!=='string' || typeof ackAt!=='string'
    || typeof signedInvoice!=='string' || signedInvoice.length>800_000 || typeof signedQr!=='string' || signedQr.length>2_400
    || signerId(key)!==claim.signerFingerprint) return null;
  const simulated=claim.tier==='simulation';
  if (!(simulated ? /^SIM-[a-f0-9-]{36}$/.test(reference)&&/^SIM-ACK-[a-f0-9-]{36}$/.test(ackNumber)
    : /^[a-f0-9]{64}$/.test(reference)&&/^[1-9][0-9]{0,29}$/.test(ackNumber))) return null;
  const date=instant(ackAt), issueDate=claim.request.DocDtls.Dt.split('/').reverse().join('-');
  if (!Number.isFinite(date) || date>now+5000 || indiaDay(date)<issueDate
    || (claim.reportingDeadline && indiaDay(date)>claim.reportingDeadline)) return null;
  const inv=embedded(verifiedJwsObject(signedInvoice,key)), qr=embedded(verifiedJwsObject(signedQr,key));
  if (!inv || !qr || inv.Irn!==reference || qr.Irn!==reference || inv.AckNo!==ackNumber || instant(inv.AckDt)!==date
    || (simulated ? inv.Simulation!==true || qr.Simulation!==true : inv.Simulation!==undefined || qr.Simulation!==undefined)) return null;
  const {DocDtls:doc,SellerDtls:seller,BuyerDtls:buyer,ValDtls:value,ItemList:items}=claim.request;
  // This domestic services subset has one saved SAC for every line.
  const mainSac=items[0]?.HsnCd;
  if (!mainSac || items.some(item=>item.HsnCd!==mainSac) || qr.MainHsnCode!==mainSac) return null;
  if (qr.DocNo!==doc.No || qr.DocTyp!==doc.Typ || qr.DocDt!==doc.Dt || qr.SellerGstin!==seller.Gstin || qr.BuyerGstin!==buyer.Gstin
    || qr.TotInvVal!==value.TotInvVal || qr.ItemCnt!==items.length) return null;
  for (const field of ['Version','TranDtls','DocDtls','SellerDtls','BuyerDtls','ItemList','ValDtls','RefDtls','ExpDtls','EwbDtls'] as const) {
    if (fingerprint(inv[field]??null)!==fingerprint(object(claim.request)[field]??null)) return null;
  }
  return {reference,number:ackNumber,at:ackAt,invoice:signedInvoice,qr:signedQr,signer:claim.signerFingerprint};
}
export const canCancelAt = (ack: unknown, now: number): boolean => {
  const start=instant(ack);
  return Number.isFinite(start) && now>=start && now<start+86_400_000;
};
export function verifyCancellation(input: unknown, claim: Claim, now: number): CancelEvidence | null {
  const {reference,at}=object(input), t=instant(at);
  return typeof at==='string' && typeof reference==='string' && reference===claim.reference && t<=now+5000
    && canCancelAt(claim.acknowledgedAt,t) ? {reference,at}:null;
}
