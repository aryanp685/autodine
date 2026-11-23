'use server';

import { revalidatePath } from 'next/cache';
import { CASHIER_ROLES, getStaffContext } from '@/lib/db/staff';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PrintFormat = '58mm' | '80mm' | 'a4' | 'pdf' | 'escpos';

export type RecordReprintResult =
  | { ok: true; copyNumber: number; isDuplicate: boolean }
  | { ok: false; error: string };

export async function recordInvoiceReprintAction(
  invoiceId: string,
  format: PrintFormat,
): Promise<RecordReprintResult> {
  const id = String(invoiceId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'Invalid invoice id.' };
  if (!['58mm', '80mm', 'a4', 'pdf', 'escpos'].includes(format)) {
    return { ok: false, error: 'Unsupported print format.' };
  }

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to record invoice printing.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: 'Only owner, manager, or cashier can print official bills.' };
  }

  const { data, error } = await staff.supabase.rpc('record_invoice_reprint', {
    p_invoice_id: id,
    p_format: format,
  });
  if (error) {
    // Graceful fallback when running against pre-v2 DBs without record_invoice_reprint.
    const msg = error.message.toLowerCase();
    if (msg.includes('could not find the function') || msg.includes('does not exist')) {
      return { ok: true, copyNumber: 1, isDuplicate: false };
    }
    return { ok: false, error: error.message };
  }

  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const copyNumber = typeof obj.copy_number === 'number' ? obj.copy_number : 1;
  const isDuplicate = Boolean(obj.is_duplicate);

  revalidatePath(`/invoice/${id}`);
  return { ok: true, copyNumber, isDuplicate };
}
