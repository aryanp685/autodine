'use server';

import { dbErrorReference } from '@/lib/db/error-reference';
import { revalidatePath } from 'next/cache';
import { CASHIER_ROLES, getStaffContext, type StaffContext } from '@/lib/db/staff';
import { normalizeCheckoutRecipient, type CheckoutRecipient } from '@/lib/gst/buyer';

export type MarkSessionPaidResult =
  | { ok: true; paidAt: string }
  | { ok: false; error: string };

export type CheckoutSessionResult =
  | { ok: true; invoiceId: string; invoiceUrl: string }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function inSelectedOutlet(staff: StaffContext, id: string): Promise<boolean> {
  const { data, error } = await staff.supabase.from('order_sessions').select('id')
    .eq('id', id).eq('restaurant_id', staff.restaurantId).maybeSingle();
  return !error && data?.id === id;
}

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

  if (!await inSelectedOutlet(staff, id)) {
    return { ok: false, error: 'This table is not in the selected outlet. Reload before recording payment.' };
  }
  const { data, error } = await staff.supabase.rpc('mark_order_session_paid', {
    p_order_session_id: id,
  });

  if (error) {
    console.error('[table-settlement] result not verified', dbErrorReference(error));
    return { ok: false, error: 'Could not verify settlement. Check the saved ticket and payment ledger before collecting or recording again.' };
  }
  if (!data) return { ok: false, error: 'The paid status could not be verified. Refresh and check the table.' };

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  revalidatePath('/cashier');
  return { ok: true, paidAt: data };
}

/** Close a table and issue its immutable final receipt atomically. */
export async function checkoutSessionAction(sessionId: string, recipient?: CheckoutRecipient): Promise<CheckoutSessionResult> {
  const id = String(sessionId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'This table session is invalid. Refresh the dashboard.' };

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to check out this table.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: `Your role (${staff.role}) cannot check out tables. Ask an owner or manager.` };
  }
  const checked = recipient ? normalizeCheckoutRecipient(recipient) : null;
  if (checked && !checked.ok) return checked;
  const pRecipient = checked?.data ?? null;
  if (!await inSelectedOutlet(staff, id)) {
    return { ok: false, error: 'This table is not in the selected outlet. Reload before issuing a document.' };
  }

  const { data, error } = await staff.supabase.rpc('close_order_session_and_issue_receipt', {
    p_order_session_id: id,
    ...(pRecipient ? { p_recipient: pRecipient } : {}),
  });
  if (error) {
    console.error('[table-close] result not verified', dbErrorReference(error));
    const reason = error.code === 'P0001' && ['Collect the full outstanding balance before closing this table session.',
      'Collect the full outstanding balance before issuing this session receipt.',
      'This table session has no non-cancelled tickets to bill.',
      'This restaurant is in read-only mode. Restore access before checkout.'].includes(error.message) ? error.message : null;
    return { ok: false, error: reason ?? 'Could not verify checkout. Check the saved receipt and billing settings before trying again.' };
  }
  if (typeof data !== 'string' || !UUID.test(data)) {
    return { ok: false, error: 'Checkout could not be verified. Refresh and check the table before trying again.' };
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  revalidatePath('/cashier');
  revalidatePath(`/invoice/${data}`);
  return { ok: true, invoiceId: data, invoiceUrl: `/invoice/${data}` };
}
