/**
 * The e-Invoice document state machine. Transitions are explicit and total —
 * an unknown transition is a programming error, not a fallback.
 */

export type IrpStatus = 'not_required' | 'pending' | 'generated' | 'failed' | 'cancelled';

export type IrpEvent =
  /** Issue-time applicability said "not required" — final, no path forward. */
  | { kind: 'markNotRequired' }
  /** IRP accepted the document; IRN validated and stored. */
  | { kind: 'irnGenerated' }
  /** IRP rejected or transport failed. */
  | { kind: 'irnFailed' }
  /** Retry after a failure — re-enters the pending queue. */
  | { kind: 'retry' }
  /** IRN cancelled within the IRP window (24h from generation). */
  | { kind: 'cancel' };

const EDGES: Record<IrpStatus, Partial<Record<IrpEvent['kind'], IrpStatus>>> = {
  not_required: {}, // frozen at issue time
  pending: { irnGenerated: 'generated', irnFailed: 'failed' },
  generated: { cancel: 'cancelled' },
  failed: { retry: 'pending' },
  cancelled: {}, // terminal
};

export class IrpStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IrpStateError';
  }
}

export function transitionIrpStatus(current: IrpStatus, event: IrpEvent): IrpStatus {
  const next = EDGES[current]?.[event.kind];
  if (!next) {
    throw new IrpStateError(`Cannot apply '${event.kind}' to an e-invoice in state '${current}'.`);
  }
  return next;
}

/** Terminal documents can never change; 'pending'/'failed' block final rendering. */
export function isFinalTaxInvoice(status: IrpStatus): boolean {
  return status === 'not_required' || status === 'generated';
}
