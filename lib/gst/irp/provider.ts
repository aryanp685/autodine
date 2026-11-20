/** Provider-independent worker contract. Real transport, signer trust data
 * and live release are intentionally not wired. The PostgreSQL rehearsal
 * store can exercise the control plane but cannot persist signed artifacts. */
import { verify, type KeyObject } from 'node:crypto';
import { fingerprint } from './fingerprint';
import { toValidatedInv01, type Inv01 } from './inv01';
import { gstFinancialYearStart, validIndianBillingDate, type ReportingCategory } from '../onboarding';
import { reportingWindow } from '../applicability';
import type { IrpCancelReason, IrpPayloadV1 } from './types';

export type ProviderEnvironment = 'provider_test' | 'provider_live';
export type IrpIdentity = { sellerGstin: string; fyStart: number; documentType: string; number: string };
export const documentIdentity = (p: IrpPayloadV1): IrpIdentity => ({ sellerGstin: p.seller.gstin, fyStart: gstFinancialYearStart(p.issuedDate),
  documentType: p.documentType, number: p.documentNumber.toUpperCase() });
export function documentKey(p: IrpPayloadV1): string {
  const i = documentIdentity(p);
  return `${i.sellerGstin}:${i.fyStart}:${i.documentType}:${i.number}`;
}
export type ProviderResult = { kind: 'acknowledged'; body: unknown }
  | { kind: 'rejected'; code: string } | { kind: 'duplicate' } | { kind: 'indeterminate' }
  | { kind: 'not_dispatched' }; // positive evidence no bytes were accepted, not a generic HTTP timeout
export type LookupResult = { kind: 'found'; body: unknown } | { kind: 'confirmed_absent' } | { kind: 'indeterminate' };
export type CancelResult = { kind: 'confirmed_cancelled'; irn: string; at: string } | { kind: 'rejected' } | { kind: 'indeterminate' };
export interface Inv01ProviderAdapter {
  readonly id: string;
  readonly environment: ProviderEnvironment;
  generate(request: Inv01, key: string, signal: AbortSignal): Promise<ProviderResult>;
  lookup(identity: IrpIdentity, signal: AbortSignal): Promise<LookupResult>;
  /** Explicit cancellation lookup, never infer cancellation from generic absence. */
  lookupCancellation?(request: { identity: IrpIdentity; irn: string }, signal: AbortSignal): Promise<CancelResult | { kind: 'confirmed_active' }>;
  cancel(request: { irn: string; reason: IrpCancelReason; remark: string }, key: string, signal: AbortSignal): Promise<CancelResult>;
}
export type VerifiedAcknowledgement = { irn: string; acknowledgementNo: string; acknowledgedAt: string; signedInvoice: string; signedQr: string };
export type VerifyAcknowledgement = (body: unknown, payload: IrpPayloadV1) => VerifiedAcknowledgement | null;
export type ProviderJob = {
  jobId?: string;
  revision: number;
  updatedAt?: string;
  documentKey: string;
  environment: ProviderEnvironment;
  providerId: string;
  payloadSha256: string;
  state: 'prepared' | 'dispatching' | 'reconcile' | 'retryable' | 'rejected' | 'verified' | 'cancel_dispatching' | 'cancelled';
  acknowledgement?: VerifiedAcknowledgement;
  responseSha256?: string;
  issue?: string;
  operation?: 'generate' | 'cancel';
  result?: 'dispatch' | 'outcome' | 'lookup' | 'abandoned';
  cancelledAt?: string;
};

export interface IrpJobStore {
  /** Keyed by environment and statutory identity. Reject conflicting body/provider. */
  reserve(job: ProviderJob, request: Inv01): Promise<ProviderJob>;
  /** Atomic compare-and-swap of the persisted state (and matching fingerprint/provider). */
  compareAndSwap(previous: ProviderJob, next: ProviderJob): Promise<boolean>;
}

const DEFAULT_DEADLINE_MS = 10_000;
const ABANDONED_AFTER_MS = 120_000;

async function boundedResult<T>(invoke: (signal: AbortSignal) => Promise<T>, fallback: T, deadline = DEFAULT_DEADLINE_MS): Promise<T> {
  if (!Number.isInteger(deadline) || deadline < 1 || deadline > 30_000) throw new RangeError('Invalid transport deadline.');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<T>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(fallback); }, deadline); }),
      Promise.resolve().then(() => invoke(controller.signal)).catch(() => fallback),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

const moved = (job: ProviderJob, patch: Partial<ProviderJob>): ProviderJob => ({ ...job,
  revision:job.revision+1, updatedAt:new Date().toISOString(), responseSha256:undefined, issue:undefined, ...patch });
function responseDigest(result: unknown) {
  try { return fingerprint(result); } catch { return undefined; }
}
function verifiedOrNull(verifyAck: VerifyAcknowledgement, body: unknown, payload: IrpPayloadV1) {
  try { return verifyAck(body,payload); } catch { return null; }
}

export async function recoverAbandonedIrpJob(store: IrpJobStore, job: ProviderJob, now: number): Promise<ProviderJob> {
  if ((job.state !== 'dispatching' && job.state !== 'cancel_dispatching') || !job.updatedAt
    || !(now - instant(job.updatedAt) >= ABANDONED_AFTER_MS)) return job;
  const next = moved(job, {state:'reconcile',issue:'abandoned_dispatch',result:'abandoned'});
  return await store.compareAndSwap(job,next) ? next : job;
}

export async function advanceIrpJob(input: { payload: IrpPayloadV1; reportingCategory: ReportingCategory; reportingDate: string;
  environment: ProviderEnvironment; adapter: Inv01ProviderAdapter; store: IrpJobStore; verifyAck: VerifyAcknowledgement; deadlineMs?: number }): Promise<ProviderJob> {
  const { payload, adapter, environment, store, verifyAck, deadlineMs } = input;
  if (environment !== 'provider_test' || adapter.environment !== environment) {
    throw new Error('IRP environment mismatch or live transport disabled.');
  }
  if (deadlineMs !== undefined && (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30_000)) throw new RangeError('Invalid transport deadline.');
  const request = toValidatedInv01(payload);
  const key = documentKey(payload);
  const identity = documentIdentity(payload);
  const job = await store.reserve({ documentKey: key, environment, providerId: adapter.id,
    payloadSha256: fingerprint(request), state: 'prepared', revision:0 }, request);
  if (job.documentKey !== key || job.environment !== environment || job.providerId !== adapter.id || job.payloadSha256 !== fingerprint(request)) {
    throw new Error('IRP identity, environment or payload conflict.');
  }
  // Never replay open dispatch. Abandoned dispatch recovery only changes the
  // durable marker and must follow with authoritative lookup, not a resend.
  if (job.state === 'reconcile' && job.operation === 'cancel') {
    if (!adapter.lookupCancellation || !job.acknowledgement) return job;
    const { irn } = job.acknowledgement;
    const lookup = await boundedResult<CancelResult | { kind:'confirmed_active' }>(
      signal => adapter.lookupCancellation!({ identity,irn },signal), {kind:'indeterminate'}, deadlineMs);
    return commitCancellationResult(store,job,lookup,'lookup');
  }
  if (job.state === 'reconcile') {
    const lookup = await boundedResult<LookupResult>(signal => adapter.lookup(identity,signal), {kind:'indeterminate'}, deadlineMs);
    const ack = lookup.kind === 'found' ? verifiedOrNull(verifyAck,lookup.body,payload) : null;
    const next = moved(job, { operation:'generate',result:'lookup',responseSha256:responseDigest(lookup), ...(ack ? { state:'verified' as const, acknowledgement:ack }
      : lookup.kind === 'confirmed_absent' ? { state:'retryable' as const, issue:'provider_confirmed_absent' }
      : { issue:lookup.kind === 'indeterminate' ? 'lookup_indeterminate' : 'unverified_lookup' }) });
    return await store.compareAndSwap(job, next) ? next : job;
  }
  if (job.state !== 'prepared' && job.state !== 'retryable') return job;
  const window = reportingWindow(payload.issuedDate, input.reportingDate, input.reportingCategory);
  if (!window.ok) throw new Error(`IRP reporting refused: ${window.code}.`);
  const dispatch = moved(job, { state:'dispatching', operation:'generate', result:'dispatch' });
  if (!await store.compareAndSwap(job, dispatch)) return job;
  const result = await boundedResult<ProviderResult>(signal => adapter.generate(request,key,signal), {kind:'indeterminate'}, deadlineMs);
  const outcome = {result:'outcome' as const,responseSha256:responseDigest(result)};
  let next: ProviderJob;
  switch (result.kind) {
    case 'acknowledged': {
      const ack = verifiedOrNull(verifyAck,result.body,payload);
      next = moved(dispatch, ack ? {...outcome,state:'verified',acknowledgement:ack}
        : {...outcome,state:'reconcile',issue:'unverified_response'});
      break;
    }
    case 'rejected': next = moved(dispatch,{...outcome,state:'rejected',issue:'provider_rejected'}); break;
    case 'not_dispatched': next = moved(dispatch,{...outcome,state:'retryable',issue:'confirmed_not_dispatched'}); break;
    default: next = moved(dispatch,{...outcome,state:'reconcile',issue:result.kind === 'duplicate' ? 'provider_duplicate' : 'transport_uncertain'});
  }
  if (!await store.compareAndSwap(dispatch, next)) throw new Error('IRP outcome not persisted; reconcile before retrying.');
  return next;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const instant = (v: unknown) => typeof v === 'string' && INSTANT.test(v) && validIndianBillingDate(v.slice(0,10)) ? Date.parse(v) : NaN;
export function isWithinCancellationWindow(ackAt: string, now: number) {
  const elapsed = now - instant(ackAt);
  return elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000;
}

async function commitCancellationResult(store: IrpJobStore, job: ProviderJob, outcome: CancelResult | {kind:'confirmed_active'}, source: 'outcome' | 'lookup') {
  const ack = job.acknowledgement;
  const patch = { result:source,responseSha256:responseDigest(outcome) };
  const next = moved(job, ack && outcome.kind === 'confirmed_cancelled' && outcome.irn === ack.irn
    && isWithinCancellationWindow(ack.acknowledgedAt,instant(outcome.at))
    ? {...patch,state:'cancelled',cancelledAt:outcome.at}
    : (outcome.kind === 'rejected' && source === 'outcome') || (outcome.kind === 'confirmed_active' && source === 'lookup')
      ? {...patch,state:'verified',issue:'cancellation_not_applied'}
      : {...patch,state:'reconcile',issue:'cancellation_uncertain'});
  if (!await store.compareAndSwap(job,next)) throw new Error('IRP cancellation outcome not persisted; reconcile.');
  return next;
}

export async function cancelIrpJob(input: { job: ProviderJob; adapter: Inv01ProviderAdapter; store: IrpJobStore;
  now: number; reason: IrpCancelReason; remark: string; ewayBill: 'none' | 'cancelled' | 'active' | 'unknown' }): Promise<ProviderJob> {
  const { job, adapter, store } = input;
  if (job.state !== 'verified' || !job.acknowledgement || job.environment !== 'provider_test'
    || job.environment !== adapter.environment || job.providerId !== adapter.id
    || !isWithinCancellationWindow(job.acknowledgement.acknowledgedAt, input.now)
    || !['none','cancelled'].includes(input.ewayBill) || !['1','2','3','4'].includes(input.reason)
    || input.remark.trim().length < 3 || input.remark.trim().length > 100) throw new Error('IRP cancellation prerequisites not met.');
  const { irn } = job.acknowledgement;
  const dispatch = moved(job,{state:'cancel_dispatching',operation:'cancel',result:'dispatch'});
  if (!await store.compareAndSwap(job, dispatch)) return job;
  const result = await boundedResult<CancelResult>(signal => adapter.cancel({ irn, reason:input.reason, remark:input.remark.trim() }, `${job.documentKey}:cancel`,signal), {kind:'indeterminate'});
  return commitCancellationResult(store,dispatch,result,'outcome');
}

/** Never trust a header's embedded key or algorithm. Caller supplies the
 * independently obtained key for the selected approved provider/environment. */
export function verifiedJwsObject(jws: string, key: KeyObject): Record<string, unknown> | null {
  if (jws.length > 1_048_576 || key.type !== 'public' || key.asymmetricKeyType !== 'rsa') return null;
  const parts = jws.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'RS256' || head.crit || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) return null;
    const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch { return null; }
}

/** Normalized NIC acknowledgement reader. The transport supplies an explicit
 * offset in AckDt (or fails); no inferred TZ or invented acknowledgement. */
export function validateNicAcknowledgement(raw: unknown, payload: IrpPayloadV1, signingKey: KeyObject): VerifiedAcknowledgement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.Status !== 'ACT' || typeof r.Irn !== 'string' || !/^[a-f0-9]{64}$/i.test(r.Irn) || typeof r.AckNo !== 'string' || !/^\d{1,20}$/.test(r.AckNo)
    || typeof r.AckDt !== 'string' || !Number.isFinite(instant(r.AckDt)) || typeof r.SignedInvoice !== 'string' || typeof r.SignedQRCode !== 'string') return null;
  const signedInv = verifiedJwsObject(r.SignedInvoice, signingKey), signedQr = verifiedJwsObject(r.SignedQRCode, signingKey);
  if (!signedInv || !signedQr) return null;
  const embedded = (v: Record<string, unknown>) => {
    if (typeof v.data !== 'string') return v;
    try { return JSON.parse(v.data) as Record<string, unknown>; } catch { return null; }
  };
  const qr = embedded(signedQr), inv = embedded(signedInv);
  if (!qr || !inv || qr.Irn !== r.Irn || inv.Irn !== r.Irn || qr.SellerGstin !== payload.seller.gstin
    || qr.BuyerGstin !== payload.buyer?.gstin || qr.DocNo !== payload.documentNumber || qr.DocTyp !== payload.documentType
    || qr.DocDt !== payload.issuedDate.split('-').reverse().join('/') || Math.round(Number(qr.TotInvVal) * 100) !== payload.values.totalPaise) return null;
  // Both artifacts must bind to the expected request; match every supported
  // field rather than accepting a signed but different invoice.
  const request = toValidatedInv01(payload);
  for (const key of ['Version','TranDtls','DocDtls','SellerDtls','BuyerDtls','ValDtls','ItemList','RefDtls'] as const) {
    if (fingerprint(inv[key] ?? null) !== fingerprint(request[key] ?? null)) return null;
  }
  return { irn: r.Irn, acknowledgementNo: r.AckNo, acknowledgedAt: r.AckDt,
    signedInvoice: r.SignedInvoice, signedQr: r.SignedQRCode };
}
