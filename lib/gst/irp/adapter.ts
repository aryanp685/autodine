/**
 * The IRP/GSP provider interface every e-Invoice integration must implement.
 *
 * Implementations bind credentials at construction time from the deployment
 * environment — never from the database, never from source. AutoDine ships
 * exactly one implementation today: the offline sandbox stub
 * (./sandbox.ts, providerId 'sandbox'), which is credential-free and makes
 * no network calls. Anything else (NIC direct, a GSP such as ClearTax /
 * Masters India / etc.) is a separate, explicitly-approved integration and
 * must not be wired in without the owner's written go-ahead.
 */

export type { IrpAdapter, IrpAck, IrpOutcome, IrpCancelOutcome, IrpCancelReason, IrpPayloadV1 } from './types';
export { IRP_CANCEL_REASONS } from './types';
