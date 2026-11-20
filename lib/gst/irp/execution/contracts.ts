/** Server/worker transport boundary. It accepts normalized evidence, never
 * assigns a provider's legal IRN. No adapter is registered by the web app. */
import type { KeyObject } from 'node:crypto';
import type { Inv01 } from '../inv01';
import type { IrpCancelReason } from '../types';

export type Tier = 'simulation' | 'authority';
export type Operation = 'generate' | 'lookup' | 'cancel' | 'lookup_cancel';
export type Claim = {
  id: string; outlet: string; routeId: string; token: string; operation: Operation; documentKey: string;
  request: Inv01; seller: string; provider: string; apiVersion: string; schemaVersion: string;
  tier: Tier; signerFingerprint: string; leaseUntil: string; reportingDeadline: string | null;
  reason: IrpCancelReason | null; reference: string | null; acknowledgedAt: string | null;
};
export type AcceptedEvidence = { reference: string; number: string; at: string; invoice: string; qr: string; signer: string };
export type CancelEvidence = { reference: string; at: string };
export type OutcomeCode = 'verified' | 'declined' | 'duplicate' | 'uncertain' | 'invalid_reply' | 'invalid_request' |
  'confirmed_absent' | 'not_sent' | 'cancelled' | 'confirmed_active' | 'cancel_blocked';
export type Outcome = { code: OutcomeCode; digest?: string; evidence?: AcceptedEvidence | CancelEvidence };

/** `declined`, `not_sent`, `absent` and `active` mean positive, definitive
 * evidence for this exact operation. HTTP status/network timeouts are not
 * evidence. Only a vetted adapter can classify its provider's codes. */
export type GenerateReply = { kind:'accepted'; body:unknown } | { kind:'declined' | 'duplicate' | 'unknown' | 'not_sent' };
export type LookupReply = { kind:'accepted'; body:unknown } | { kind:'absent'; documentKey:string } | { kind:'unknown' };
export type CancelReply = { kind:'cancelled'; evidence:CancelEvidence } | { kind:'declined' | 'unknown' | 'not_sent' };
export type LookupCancelReply = { kind:'cancelled'; evidence:CancelEvidence } | { kind:'active'; documentKey:string; reference:string } | { kind:'unknown' };
export interface ProviderSession {
  generate(request: Inv01, idempotencyKey: string, signal: AbortSignal): Promise<GenerateReply>;
  lookup(documentKey: string, signal: AbortSignal): Promise<LookupReply>;
  ewayBill(reference: string, signal: AbortSignal): Promise<'none' | 'cancelled' | 'active' | 'unknown'>;
  cancel(reference: string, reason: IrpCancelReason, remark: string, idempotencyKey: string, signal: AbortSignal): Promise<CancelReply>;
  lookupCancellation(documentKey: string, reference: string, signal: AbortSignal): Promise<LookupCancelReply>;
}
/** A provider implementation may use a deployment-owned credential broker
 * for the bound seller. It owns endpoint pinning, auth, signatures/encryption
 * and protocol normalization; neither job data nor a user's form chooses a host. */
export type ProviderScope = Readonly<{ outlet: string; seller: string; provider: string; tier: Tier }>;
export interface ProviderAdapter {
  readonly key: string;
  readonly apiVersion: string;
  readonly schemaVersions: readonly string[];
  readonly tier: Tier;
  readonly signingPublicKey: KeyObject;
  readonly capabilities: Readonly<{ operations: readonly Operation[]; domesticServices: boolean; security: 'isolated-simulator' | 'authenticated-provider' }>;
  open(scope: ProviderScope, signal: AbortSignal): Promise<ProviderSession>;
}
export interface ExecutionStore {
  claim(outlet: string, route: string, job?: string): Promise<Claim | null>;
  sweep(outlet: string, route: string): Promise<number>;
  finish(claim: Claim, outcome: Outcome, latencyMs: number): Promise<boolean>;
}
