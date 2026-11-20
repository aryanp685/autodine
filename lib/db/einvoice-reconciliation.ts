/**
 * e-Invoice reconciliation — the owner/manager follow-up list.
 *
 * Reads `list_restaurant_irp_reconciliation()` (migration 20261114000200):
 * every document still recorded as IRP 'pending' or 'failed', with the
 * attempt count and last attempt from the append-only restaurant_irp_requests
 * audit. The function is SECURITY INVOKER and RLS scopes the rows, so a
 * restaurant can never see another's documents.
 *
 * Owner/manager read access, restricted to the selected outlet. A separate
 * metadata projection labels any local preparation, never an IRP submission.
 * Cashiers do not query the follow-up list.
 */

import { getStaffContextDetailed } from '@/lib/db/staff';

export type EinvoiceReconciliationRow = {
  invoiceId: string;
  invoiceNumber: string;
  documentType: string;
  irpStatus: 'pending' | 'failed';
  isB2b: boolean;
  issuedAt: string;
  lastAttemptAt: string | null;
  attemptCount: number;
  preparedAt?: string;
};

export type EinvoiceReconciliationResult =
  | { ok: true; visible: false }
  | { ok: true; visible: true; rows: EinvoiceReconciliationRow[] }
  | { ok: false; reason: 'unconfigured' | 'signed-out' | 'no-membership' | 'unavailable' };

export async function getEinvoiceReconciliation(): Promise<EinvoiceReconciliationResult> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) {
    return { ok: false, reason: staff.reason === 'unconfigured' || staff.reason === 'signed-out' || staff.reason === 'no-membership' ? staff.reason : 'unavailable' };
  }
  const role = staff.context.role;
  if (role !== 'owner' && role !== 'manager') return { ok: true, visible: false };

  const [{ data, error }, prep] = await Promise.all([
    staff.context.supabase.rpc('list_restaurant_irp_reconciliation'),
    staff.context.supabase.rpc('list_gst_irp_preflights', { p_outlet: staff.context.restaurantId }),
  ]);
  const preparations = new Map<string,string>();
  if (!prep.error && Array.isArray(prep.data)) for (const row of prep.data) {
    if (row && typeof row === 'object' && !Array.isArray(row) && typeof row.invoice_id === 'string' && typeof row.created_at === 'string') {
      preparations.set(row.invoice_id,row.created_at);
    }
  }
  if (error) return { ok: false, reason: 'unavailable' };

  const rows: EinvoiceReconciliationRow[] = (data ?? []).filter((row) => row.restaurant_id === staff.context.restaurantId).map((row) => ({
    invoiceId: String(row.invoice_id),
    invoiceNumber: String(row.invoice_number),
    documentType: String(row.document_type),
    irpStatus: row.irp_status === 'failed' ? 'failed' : 'pending',
    isB2b: row.is_b2b === true,
    issuedAt: typeof row.issued_at === 'string' ? row.issued_at : '',
    lastAttemptAt: typeof row.last_attempt_at === 'string' ? row.last_attempt_at : null,
    preparedAt: preparations.get(row.invoice_id),
    attemptCount: Number.isFinite(Number(row.attempt_count)) ? Number(row.attempt_count) : 0,
  }));
  return { ok: true, visible: true, rows };
}
