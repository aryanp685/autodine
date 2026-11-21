'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { CASHIER_ROLES, getStaffContext } from '@/lib/db/staff';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InvoiceShareActionResult =
  | { ok: true; id: string; path?: string; expiresAt?: string }
  | { ok: false; error: string };

/** Create a 24-hour, one-invoice bearer link; only the token digest is stored. */
export async function createInvoiceShareLinkAction(invoiceId: string): Promise<InvoiceShareActionResult> {
  const id = String(invoiceId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'This receipt is invalid. Refresh the page.' };

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to create a receipt link.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: 'Only owner, manager and cashier roles can create receipt links.' };
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await staff.supabase.rpc('create_restaurant_invoice_share_link', {
    p_invoice_id: id,
    p_token_hash: tokenHash,
  });
  const created = data?.[0];
  if (error || !created?.share_link_id || !created.expires_at) {
    return { ok: false, error: error?.message ?? 'The receipt link could not be verified. Try again.' };
  }

  revalidatePath(`/invoice/${id}`);
  return {
    ok: true,
    id: created.share_link_id,
    path: `/receipt-share/${token}`,
    expiresAt: created.expires_at,
  };
}

/** Revoke one link; the database confirms restaurant membership and role. */
export async function revokeInvoiceShareLinkAction(shareLinkId: string): Promise<InvoiceShareActionResult> {
  const id = String(shareLinkId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'This receipt link is invalid.' };

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to revoke a receipt link.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: 'Only owner, manager and cashier roles can revoke receipt links.' };
  }

  const { data, error } = await staff.supabase.rpc('revoke_restaurant_invoice_share_link', {
    p_share_link_id: id,
  });
  if (error || data !== true) {
    return { ok: false, error: error?.message ?? 'The receipt link was not found in this restaurant.' };
  }
  revalidatePath('/dashboard/invoices');
  return { ok: true, id };
}
