'use server';

import { revalidatePath } from 'next/cache';
import { CASHIER_ROLES, getStaffContext } from '@/lib/db/staff';

export type MarkSessionPaidResult =
  | { ok: true; paidAt: string }
  | { ok: false; error: string };

export type CheckoutSessionResult =
  | { ok: true; invoiceId: string; invoiceUrl: string }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mark one table's open session paid. The browser sends only the session UUID;
 * the SECURITY DEFINER RPC resolves the restaurant, actor, ticket amounts and
 * ledger entries transactionally.
 */
export async function markSessionPaidAction(
  sessionId: string,
): Promise<MarkSessionPaidResult> {
  const id = String(sessionId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'This table session is invalid. Refresh the dashboard.' };

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to mark this table paid.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: `Your role (${staff.role}) cannot mark payments. Ask an owner or manager.` };
  }

  const { data, error } = await staff.supabase.rpc('mark_order_session_paid', {
    p_order_session_id: id,
  });

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'The paid status could not be verified. Refresh and check the table.' };

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  revalidatePath('/cashier');
  return { ok: true, paidAt: data };
}

/** Close a table and issue its immutable final receipt atomically. */
export async function checkoutSessionAction(sessionId: string): Promise<CheckoutSessionResult> {
  const id = String(sessionId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'This table session is invalid. Refresh the dashboard.' };

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to check out this table.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: `Your role (${staff.role}) cannot check out tables. Ask an owner or manager.` };
  }

  const { data, error } = await staff.supabase.rpc('close_order_session_and_issue_receipt', {
    p_order_session_id: id,
  });
  if (error) return { ok: false, error: error.message };
  if (typeof data !== 'string' || !UUID.test(data)) {
    return { ok: false, error: 'Checkout could not be verified. Refresh and check the table before trying again.' };
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  revalidatePath('/cashier');
  revalidatePath(`/invoice/${data}`);
  return { ok: true, invoiceId: data, invoiceUrl: `/invoice/${data}` };
}
