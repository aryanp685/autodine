import { getStaffContextDetailed } from '@/lib/db/staff';
import type { MemberRole } from '@/lib/db/database';
import type { NoteDocumentType, NoteIrpStatus, NoteReasonCode } from '@/lib/gst/notes';

/**
 * Read side of the credit/debit-note ledger (migration 20261114000500).
 *
 * Owner/manager only, mirroring the issuance/void server actions: cashier
 * roles keep plain invoice history but never see note controls. The database
 * RLS policy lets any member read; the role gate is applied here and again
 * inside both RPCs — the UI never widens it.
 */

const NOTE_ROLES: readonly MemberRole[] = ['owner', 'manager'];

export type InvoiceNoteRow = {
  id: string;
  invoiceId: string;
  documentType: NoteDocumentType;
  documentNumber: string;
  status: 'issued' | 'voided';
  reasonCode: NoteReasonCode;
  reason: string;
  totalPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  irpStatus: NoteIrpStatus;
  sourceDocumentNumber: string;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

export type InvoiceNotesResult =
  | { ok: true; notes: InvoiceNoteRow[] }
  | { ok: false; reason: 'unconfigured' | 'signed-out' | 'no-membership' | 'role-denied' };

const REASON_CODES: readonly NoteReasonCode[] = [
  'returned_supply', 'quantity_difference', 'rate_difference', 'post_supply_change', 'other',
];
const IRP_STATES: readonly NoteIrpStatus[] = [
  'not_required', 'pending', 'generated', 'failed', 'cancelled',
];

export async function getInvoiceNotes(limit = 50): Promise<InvoiceNotesResult> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return { ok: false, reason: staff.reason };
  const { supabase, restaurantId, role } = staff.context;
  if (!(NOTE_ROLES as readonly MemberRole[]).includes(role)) {
    return { ok: false, reason: 'role-denied' };
  }

  const { data, error } = await supabase
    .from('restaurant_notes')
    .select('id, invoice_id, document_type, document_number, status, reason_code, reason, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, irp_status, source_document_number, issued_at, voided_at, void_reason')
    .eq('restaurant_id', restaurantId)
    .order('issued_at', { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 100));

  // restaurant_notes is created by migration 20261114000500; until it is
  // applied the screen must say so, not invent notes or crash.
  if (error) {
    if (error.code === '42P01' || /relation .* does not exist/i.test(error.message ?? '')) {
      return { ok: false, reason: 'unconfigured' };
    }
    throw new Error(`Could not load credit/debit notes: ${error.message}`);
  }

  const notes = (data ?? []).map((raw) => ({
    id: raw.id,
    invoiceId: raw.invoice_id,
    documentType: (raw.document_type === 'debit_note' ? 'debit_note' : 'credit_note') as NoteDocumentType,
    documentNumber: raw.document_number,
    status: (raw.status === 'voided' ? 'voided' : 'issued') as 'issued' | 'voided',
    reasonCode: (REASON_CODES.find((code) => code === raw.reason_code) ?? 'other') as NoteReasonCode,
    reason: raw.reason,
    totalPaise: Number(raw.total_paise) || 0,
    taxablePaise: Number(raw.taxable_paise) || 0,
    cgstPaise: Number(raw.cgst_paise) || 0,
    sgstPaise: Number(raw.sgst_paise) || 0,
    igstPaise: Number(raw.igst_paise) || 0,
    irpStatus: (IRP_STATES.find((state) => state === raw.irp_status) ?? 'pending') as NoteIrpStatus,
    sourceDocumentNumber: raw.source_document_number,
    issuedAt: raw.issued_at,
    voidedAt: raw.voided_at,
    voidReason: raw.void_reason,
  }));

  return { ok: true, notes };
}
