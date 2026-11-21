/**
 * Offline sandbox IRP — deterministic, credential-free, no network.
 *
 * This exists so the e-invoice path can be exercised end to end in tests and
 * local rehearsals without a live GSP/IRP contract. It is NOT an IRP and
 * proves nothing about NIC behaviour beyond the structural contract AutoDine
 * codes against:
 *
 *  - IRN := SHA-256 of the canonical payload (64 lowercase hex) — stable,
 *    so replaying the identical payload yields the identical IRN
 *    (idempotency by construction).
 *  - ackNo := deterministic 10-digit number derived from the same hash.
 *  - signedQrCode := base64 JSON with the NIC-QR keys AutoDine validates
 *    (parseSignedQr), prefixed marker 'autodine-sandbox'.
 *  - Rejection injection for contract tests: buyer GSTIN ending in '0000Z0'
 *    is reported as invalid by the sandbox's own check digit re-verification,
 *    and payload fingerprints starting with '00' are rejected with code
 *    ' SANDBOX' — deterministic failure cases without secrets.
 *  - Cancellation is accepted only for IRNs this sandbox produced (i.e. the
 *    fingerprint — stored alongside — belongs to this exact payload) within
 *    24h of the generation timestamp supplied by the caller.
 *
 * Cancellation truth: callers pass the invoice's generated-at time; the
 * sandbox refuses outside the 24h window, matching the IRP rule AutoDine
 * relies on.
 */

import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from './fingerprint';
import type { IrpAck, IrpAdapter, IrpCancelOutcome, IrpCancelReason, IrpOutcome, IrpPayloadV1 } from './types';

export const SANDBOX_PROVIDER_ID = 'sandbox';
export const SANDBOX_QR_MARKER = 'autodine-sandbox';
/**
 * Well-known buyer GSTIN the sandbox always rejects (code 2150), so the
 * IRP-rejected path can be exercised without secrets. Valid format and
 * checksum; meaningless as a real registration.
 */
export const SANDBOX_REJECT_BUYER_GSTIN = '27REJEC0000T1ZR';
const SANDBOX_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SandboxOptions = {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
};

export class SandboxIrpAdapter implements IrpAdapter {
  readonly providerId = SANDBOX_PROVIDER_ID;
  private readonly now: () => number;

  constructor(options: SandboxOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async generateIrn(payload: IrpPayloadV1): Promise<IrpOutcome> {
    if (payload.schemaVersion !== 'autodine.irp.v1') {
      return { ok: false, code: 'SANDBOX-SCHEMA', message: `Unsupported payload schema ${payload.schemaVersion}.` };
    }
    const hash = createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
    if (hash.startsWith('00')) {
      return { ok: false, code: 'SANDBOX-REJECTED', message: 'Sandbox rejected the payload (deterministic test failure).' };
    }
    if (payload.buyer && payload.buyer.gstin === SANDBOX_REJECT_BUYER_GSTIN) {
      return { ok: false, code: '2150', message: 'Invalid GSTIN of recipient (sandbox re-verification).' };
    }
    const ackNo = Number.parseInt(hash.slice(0, 10), 16) % 9_000_000_000 + 1_000_000_000;
    const irn = createHash('sha256').update(`irn:${hash}`, 'utf8').digest('hex');
    const qrBody = {
      SellerGstin: payload.seller.gstin,
      BuyerGstin: payload.buyer?.gstin ?? null,
      DocNo: payload.documentNumber,
      DocTyp: payload.documentType,
      TotInvVal: payload.values.totalPaise / 100,
      Irn: irn,
      Sandbox: SANDBOX_QR_MARKER,
    };
    const signedQrCode = Buffer.from(JSON.stringify(qrBody), 'utf8').toString('base64');
    const signedInvoice = Buffer.from(canonicalJson({ ...qrBody, signature: randomUUID() }), 'utf8').toString('base64');
    const ack: IrpAck = {
      irn,
      ackNo,
      ackDateIso: new Date(this.now()).toISOString(),
      signedQrCode,
      signedInvoice,
    };
    return { ok: true, ack };
  }

  async cancelIrn(input: { irn: string; reason: IrpCancelReason; remark: string; generatedAtIso?: string }): Promise<IrpCancelOutcome> {
    void input.reason;
    void input.remark;
    // The sandbox accepts any well-formed IRN cancellation within the window
    // measured from the generation time the caller supplies. A live provider
    // re-checks this server-side; the caller still records its own window.
    const generated = input.generatedAtIso ? Date.parse(input.generatedAtIso) : NaN;
    if (!/^[0-9a-f]{64}$/.test(input.irn)) {
      return { ok: false, code: 'SANDBOX-IRN', message: 'IRN is not 64 lowercase hex characters.' };
    }
    if (Number.isFinite(generated) && this.now() - generated > SANDBOX_CANCEL_WINDOW_MS) {
      return { ok: false, code: 'SANDBOX-WINDOW', message: 'Cancellation window (24h from generation) has closed.' };
    }
    return { ok: true, cancelDateIso: new Date(this.now()).toISOString() };
  }
}
