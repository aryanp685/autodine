'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContext } from '@/lib/db/staff';
import { isNoteDocumentType, isNoteReasonCode, validateNoteReason, type NoteDocumentType, type NoteReasonCode } from '@/lib/gst/notes';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors the database: only owner/manager may issue or void notes. */
const NOTE_ROLES = ['owner', 'manager'] as const;

export type NoteActionResult = { ok: true; id: string } | { ok: false; error: string };

export type IssueInvoiceNoteInput = {
  invoiceId: string;
  documentType: string;
  reasonCode: string;
  reason: string;
};

/**
 * Issue an immutable credit/debit note covering the full source GST document.
 * The database owns numbering, snapshot amounts and the one-live-note rule;
 * this action only validates shape and enforces the owner/manager gate
 * before the call, so kitchen/cashier staff never reach it.
 */
export async function issueInvoiceNoteAction(input: IssueInvoiceNoteInput): Promise<NoteActionResult> {
  const invoiceId = String(input?.invoiceId ?? '').trim();
  if (!UUID.test(invoiceId)) return { ok: false, error: 'Select a valid GST document.' };
  if (!isNoteDocumentType(input?.documentType)) {
    return { ok: false, error: 'Choose a credit note or a debit note.' };
  }
  if (!isNoteReasonCode(input?.reasonCode)) {
    return { ok: false, error: 'Choose a reason from the list.' };
  }
  const reason = validateNoteReason(input?.reason);
  if (!reason.ok) return { ok: false, error: reason.error };

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to issue a note.' };
  if (!(NOTE_ROLES as readonly string[]).includes(staff.role)) {
    return { ok: false, error: 'Only an owner or manager can issue a credit or debit note.' };
  }

  const { data, error } = await staff.supabase.rpc('issue_invoice_note', {
    p_invoice_id: invoiceId,
    p_document_type: input.documentType as NoteDocumentType,
    p_reason_code: input.reasonCode as NoteReasonCode,
    p_reason: reason.reason,
  });
  if (error) {
    return { ok: false, error: error.message ?? 'The note could not be issued.' };
  }
  revalidatePath('/dashboard/invoices');
  return { ok: true, id: String(data ?? '') };
}

export type VoidInvoiceNoteInput = { noteId: string; reason: string };

/** Void, never delete, a note. Owner/manager only; the database audits it. */
export async function voidInvoiceNoteAction(input: VoidInvoiceNoteInput): Promise<NoteActionResult> {
  const noteId = String(input?.noteId ?? '').trim();
  if (!UUID.test(noteId)) return { ok: false, error: 'This note is invalid. Refresh the page.' };
  const reason = validateNoteReason(input?.reason);
  if (!reason.ok) return { ok: false, error: reason.error };

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to void this note.' };
  if (!(NOTE_ROLES as readonly string[]).includes(staff.role)) {
    return { ok: false, error: 'Only an owner or manager can void a credit or debit note.' };
  }

  const { error } = await staff.supabase.rpc('void_invoice_note', {
    p_note_id: noteId,
    p_reason: reason.reason,
  });
  if (error) {
    return { ok: false, error: error.message ?? 'The note could not be voided.' };
  }
  revalidatePath('/dashboard/invoices');
  return { ok: true, id: noteId };
}
