/**
 * Provider-independent helpers for credit/debit notes.
 *
 * The database owns the lifecycle (immutability, series allocation, one live
 * note of each kind per source document). This module owns the pure logic the
 * application layer and the IRP payload builder share: which document types
 * admit a note, how the note's e-Invoice posture is derived from the parent's,
 * and the internal consistency of the amount decomposition. No I/O, no dates
 * from the environment, no database access.
 */

import type { IrpDocumentKind } from './irp/types';
import { gstStateLabel } from './onboarding';
import { checkGstin } from './gstin';

export type NoteDocumentType = 'credit_note' | 'debit_note';
export type NoteIrpStatus = 'not_required' | 'pending' | 'generated' | 'failed' | 'cancelled';
export type NoteReasonCode =
  | 'returned_supply'
  | 'quantity_difference'
  | 'rate_difference'
  | 'post_supply_change'
  | 'other';

export const NOTE_REASON_CODES: readonly NoteReasonCode[] = [
  'returned_supply',
  'quantity_difference',
  'rate_difference',
  'post_supply_change',
  'other',
];

export const NOTE_REASON_LABELS: Record<NoteReasonCode, string> = {
  returned_supply: 'Supply returned',
  quantity_difference: 'Quantity difference',
  rate_difference: 'Rate / price difference',
  post_supply_change: 'Post-supply change of agreement',
  other: 'Other (see details)',
};

export type NoteReasonValidation = { ok: true; reason: string } | { ok: false; error: string };

export function validateNoteReason(reason: unknown): NoteReasonValidation {
  const trimmed = String(reason ?? '').trim();
  if (trimmed.length < 5) return { ok: false, error: 'Enter a reason of at least 5 characters.' };
  if (trimmed.length > 500) return { ok: false, error: 'Keep the reason under 500 characters.' };
  return { ok: true, reason: trimmed };
}

export function isNoteDocumentType(value: unknown): value is NoteDocumentType {
  return value === 'credit_note' || value === 'debit_note';
}

export function isNoteReasonCode(value: unknown): value is NoteReasonCode {
  return typeof value === 'string' && (NOTE_REASON_CODES as readonly string[]).includes(value);
}

export function notePrefix(documentType: NoteDocumentType): 'CN' | 'DN' {
  return documentType === 'credit_note' ? 'CN' : 'DN';
}

/** The IRP document kind carried by a note kind. */
export function irpDocumentKindFor(documentType: NoteDocumentType): Extract<IrpDocumentKind, 'CRN' | 'DBN'> {
  return documentType === 'credit_note' ? 'CRN' : 'DBN';
}

/**
 * Derive the note's e-Invoice posture from the parent's. A B2C parent (never
 * IRP-applicable) yields 'not_required'; anything else forces the note into
 * 'pending' — a note against an e-invoiced (or e-invoice-applicable) document
 * needs its own IRN before it is final. Fail-closed by construction.
 */
export function deriveNoteIrpStatus(parentIrpStatus: NoteIrpStatus): NoteIrpStatus {
  if (parentIrpStatus === 'not_required') return 'not_required';
  return 'pending';
}

export type NoteAmounts = {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};

export type NoteAmountsValidation = { ok: true } | { ok: false; error: string };

/** Internal consistency of a note decomposition. The DB enforces this too. */
export function validateNoteAmounts(amounts: NoteAmounts): NoteAmountsValidation {
  const ints = [
    amounts.taxablePaise,
    amounts.cgstPaise,
    amounts.sgstPaise,
    amounts.igstPaise,
    amounts.totalPaise,
  ];
  for (const n of ints) {
    if (!Number.isSafeInteger(n) || n < 0) {
      return { ok: false, error: 'Amounts must be non-negative integer paise.' };
    }
  }
  if (amounts.totalPaise <= 0) {
    return { ok: false, error: 'A note must move a non-zero amount.' };
  }
  if (amounts.taxablePaise + amounts.cgstPaise + amounts.sgstPaise + amounts.igstPaise !== amounts.totalPaise) {
    return { ok: false, error: 'Taxable value plus taxes does not equal the note total.' };
  }
  if (amounts.igstPaise > 0 && (amounts.cgstPaise > 0 || amounts.sgstPaise > 0)) {
    return { ok: false, error: 'CGST/SGST and IGST cannot coexist on one document.' };
  }
  return { ok: true };
}

/**
 * Whether a note of the given kind may still be issued against a source
 * document: the source must be a GST document in 'issued' status and the
 * caller must not hold a live note of the same kind already. Mirrors the
 * database's backstop checks for friendlier UI behaviour.
 */
export function canIssueNoteAgainst(input: {
  sourceDocumentType: 'receipt' | 'gst_tax_invoice' | 'bill_of_supply';
  sourceStatus: 'issued' | 'voided';
  liveNotes: ReadonlyArray<{ document_type: NoteDocumentType; status: string }>;
  requestedKind: NoteDocumentType;
}): { ok: true } | { ok: false; error: string } {
  if (input.sourceStatus !== 'issued') {
    return { ok: false, error: 'A voided document cannot be noted. Issue the replacement document instead.' };
  }
  if (input.sourceDocumentType !== 'gst_tax_invoice') {
    return { ok: false, error: 'This workflow needs an original tax invoice. Ask the owner to review a receipt or Bill of Supply correction.' };
  }
  const live = input.liveNotes.some((note) => note.document_type === input.requestedKind && note.status === 'issued');
  if (live) {
    return { ok: false, error: 'This document already has a live note of that kind. Void it before issuing a replacement.' };
  }
  return { ok: true };
}

/** Rule 53 particulars only, not an eligibility or signature determination. */
export function snapshotText(snapshot: unknown, key: string): string {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function noteParticulars(sourceType: string, seller: unknown, buyer: unknown, gst: unknown) {
  if (sourceType !== 'gst_tax_invoice' || !snapshotText(seller, 'gstin')
      || !(snapshotText(seller, 'legal_name') || snapshotText(seller, 'name')) || !snapshotText(seller, 'address')) return null;
  const rate = gst && typeof gst === 'object' ? (gst as Record<string, unknown>).rate_bps : null;
  if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 0) return null;
  const name = snapshotText(buyer, 'name'), address = snapshotText(buyer, 'address');
  const gstin = snapshotText(buyer, 'gstin'), deliveryAddress = snapshotText(buyer, 'delivery_address');
  const code = snapshotText(buyer, 'state_code'), state = gstStateLabel(code);
  if (!name || !address || (gstin ? !checkGstin(gstin).ok
    : snapshotText(buyer, 'recipient_type') !== 'consumer' || !state || ['25','28'].includes(code) || !deliveryAddress)) return null;
  return { name, address, gstin, state, deliveryAddress, rateBps: rate };
}
