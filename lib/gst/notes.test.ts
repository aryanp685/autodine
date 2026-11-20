import { describe, expect, it } from 'vitest';
import {
  canIssueNoteAgainst,
  deriveNoteIrpStatus,
  irpDocumentKindFor,
  isNoteDocumentType,
  isNoteReasonCode,
  notePrefix,
  validateNoteAmounts,
  validateNoteReason,
} from './notes';

describe('validateNoteReason', () => {
  it('accepts 5–500 char trimmed reasons and rejects empties', () => {
    expect(validateNoteReason('  Damaged goods returned  ')).toEqual({ ok: true, reason: 'Damaged goods returned' });
    expect(validateNoteReason('abc').ok).toBe(false);
    expect(validateNoteReason('   ').ok).toBe(false);
    expect(validateNoteReason('x'.repeat(501)).ok).toBe(false);
  });
});

describe('note document typing', () => {
  it('recognises the two kinds and the reason codes', () => {
    expect(isNoteDocumentType('credit_note')).toBe(true);
    expect(isNoteDocumentType('debit_note')).toBe(true);
    expect(isNoteDocumentType('invoice')).toBe(false);
    expect(isNoteReasonCode('returned_supply')).toBe(true);
    expect(isNoteReasonCode('other')).toBe(true);
    expect(isNoteReasonCode('because')).toBe(false);
  });

  it('maps kinds to prefixes and IRP document kinds', () => {
    expect(notePrefix('credit_note')).toBe('CN');
    expect(notePrefix('debit_note')).toBe('DN');
    expect(irpDocumentKindFor('credit_note')).toBe('CRN');
    expect(irpDocumentKindFor('debit_note')).toBe('DBN');
  });
});

describe('deriveNoteIrpStatus', () => {
  it('mirrors a B2C parent as not_required and fails closed otherwise', () => {
    expect(deriveNoteIrpStatus('not_required')).toBe('not_required');
    expect(deriveNoteIrpStatus('pending')).toBe('pending');
    expect(deriveNoteIrpStatus('generated')).toBe('pending');
    expect(deriveNoteIrpStatus('failed')).toBe('pending');
    expect(deriveNoteIrpStatus('cancelled')).toBe('pending');
  });
});

describe('validateNoteAmounts', () => {
  const good = { taxablePaise: 10000, cgstPaise: 250, sgstPaise: 250, igstPaise: 0, totalPaise: 10500 };

  it('accepts a consistent decomposition', () => {
    expect(validateNoteAmounts(good).ok).toBe(true);
    expect(validateNoteAmounts({ ...good, igstPaise: 500, cgstPaise: 0, sgstPaise: 0, totalPaise: 10500 }).ok).toBe(true);
  });

  it('rejects inconsistent or unsafe amounts', () => {
    expect(validateNoteAmounts({ ...good, totalPaise: 10501 }).ok).toBe(false);
    expect(validateNoteAmounts({ ...good, totalPaise: 0 }).ok).toBe(false);
    expect(validateNoteAmounts({ ...good, igstPaise: 100 }).ok).toBe(false); // both CGST and IGST
    expect(validateNoteAmounts({ ...good, taxablePaise: -1 }).ok).toBe(false);
    expect(validateNoteAmounts({ ...good, totalPaise: Number.MAX_SAFE_INTEGER + 1 }).ok).toBe(false);
  });
});

describe('canIssueNoteAgainst', () => {
  const none: never[] = [];

  it('refuses notes against plain receipts or voided documents', () => {
    expect(canIssueNoteAgainst({ sourceDocumentType: 'receipt', sourceStatus: 'issued', liveNotes: none, requestedKind: 'credit_note' }).ok).toBe(false);
    expect(canIssueNoteAgainst({ sourceDocumentType: 'gst_tax_invoice', sourceStatus: 'voided', liveNotes: none, requestedKind: 'credit_note' }).ok).toBe(false);
    expect(canIssueNoteAgainst({ sourceDocumentType: 'bill_of_supply', sourceStatus: 'issued', liveNotes: none, requestedKind: 'debit_note' }).ok).toBe(false);
  });

  it('refuses a second live note of the same kind but allows the other kind', () => {
    const live = [{ document_type: 'credit_note' as const, status: 'issued' }];
    expect(canIssueNoteAgainst({ sourceDocumentType: 'gst_tax_invoice', sourceStatus: 'issued', liveNotes: live, requestedKind: 'credit_note' }).ok).toBe(false);
    expect(canIssueNoteAgainst({ sourceDocumentType: 'gst_tax_invoice', sourceStatus: 'issued', liveNotes: live, requestedKind: 'debit_note' }).ok).toBe(true);
    const voided = [{ document_type: 'credit_note' as const, status: 'voided' }];
    expect(canIssueNoteAgainst({ sourceDocumentType: 'gst_tax_invoice', sourceStatus: 'issued', liveNotes: voided, requestedKind: 'credit_note' }).ok).toBe(true);
  });
});
