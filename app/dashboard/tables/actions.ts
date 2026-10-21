'use server';

import { randomBytes } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { requireWorkspaceForAction } from '@/lib/db/workspace-access';
import type { Database } from '@/lib/db/database';
import { canManageTableQrs } from '@/lib/qr-authorization';

type TableQr = Database['public']['Tables']['table_qr_codes']['Row'];
type DiningTable = Database['public']['Tables']['dining_tables']['Row'];

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function requireTableManager(slug: string) {
  const access = await requireWorkspaceForAction(slug);
  if (!canManageTableQrs(access.workspace.role)) {
    throw new Error('Only an owner or manager can manage tables and QR codes.');
  }
  return access;
}

async function writableWorkspace(supabase: Awaited<ReturnType<typeof requireWorkspaceForAction>>['supabase'], restaurantId: string) {
  const { data, error } = await supabase.rpc('restaurant_can_write', { p_restaurant_id: restaurantId });
  if (error) return { ok: false as const, error: 'Could not confirm workspace write access. Refresh and try again.' };
  if (data !== true) return { ok: false as const, error: 'This workspace is inactive or read-only. Existing data remains available.' };
  return { ok: true as const };
}

export async function createDiningTableAction(slug: string, labelValue: string, seatsValue: number): Promise<ActionResult<DiningTable>> {
  try {
    const access = await requireTableManager(slug);
    const label = labelValue.trim().replace(/\s+/g, ' ');
    if (!label || label.length > 32 || !Number.isInteger(seatsValue) || seatsValue < 1 || seatsValue > 30) {
      return { ok: false, error: 'Enter a table label (1–32 characters) and 1–30 whole-number seats.' };
    }
    const writable = await writableWorkspace(access.supabase, access.workspace.id);
    if (!writable.ok) return writable;

    // Use the user's session client, not the service role: RLS independently
    // enforces both manager authorization and the trial/read-only entitlement.
    const { data, error } = await access.supabase
      .from('dining_tables')
      .insert({ restaurant_id: access.workspace.id, label, seats: seatsValue, is_active: true })
      .select('id, restaurant_id, label, seats, is_active')
      .single();
    if (error || !data) return { ok: false, error: 'Could not create that table. Check that its label is unique and the workspace is writable.' };
    return { ok: true, value: data };
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}

export async function issueTableQrAction(slug: string, tableId: string): Promise<ActionResult<TableQr>> {
  try {
    const access = await requireTableManager(slug);
    const writable = await writableWorkspace(access.supabase, access.workspace.id);
    if (!writable.ok) return writable;

    const { data: table, error: tableError } = await access.supabase
      .from('dining_tables')
      .select('id, restaurant_id, is_active')
      .eq('id', tableId)
      .eq('restaurant_id', access.workspace.id)
      .maybeSingle();
    if (tableError || !table || !table.is_active) return { ok: false, error: 'That active table could not be found in this workspace.' };

    const admin = getSupabaseAdmin();
    if (!admin) return { ok: false, error: 'QR management is not configured on this server.' };
    const publicToken = randomBytes(32).toString('base64url');
    const { data, error } = await admin.rpc('issue_table_qr_code', {
      p_restaurant_id: access.workspace.id,
      p_table_id: table.id,
      p_public_token: publicToken,
      p_actor_id: access.userId,
    });
    if (error || !data) return { ok: false, error: 'Could not issue a table QR code.' };
    return { ok: true, value: data };
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}

export async function revokeTableQrAction(slug: string, qrCodeId: string): Promise<ActionResult<boolean>> {
  try {
    const access = await requireTableManager(slug);
    // QR revocation is a security/safety action, not a restaurant business
    // write. Keep it available to authorized managers during read-only mode.
    const admin = getSupabaseAdmin();
    if (!admin) return { ok: false, error: 'QR management is not configured on this server.' };
    const { data, error } = await admin.rpc('revoke_table_qr_code', {
      p_restaurant_id: access.workspace.id,
      p_qr_code_id: qrCodeId,
    });
    if (error || !data) return { ok: false, error: 'That QR could not be revoked.' };
    return { ok: true, value: true };
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}

export async function setDiningTableActiveAction(slug: string, tableId: string, isActive: boolean): Promise<ActionResult<boolean>> {
  try {
    const access = await requireTableManager(slug);
    const writable = await writableWorkspace(access.supabase, access.workspace.id);
    if (!writable.ok) return writable;

    // RLS on the authenticated client is the final authorization/entitlement
    // boundary; the service-role key is deliberately not used for table writes.
    const { data, error } = await access.supabase
      .from('dining_tables')
      .update({ is_active: isActive })
      .eq('id', tableId)
      .eq('restaurant_id', access.workspace.id)
      .select('id')
      .maybeSingle();
    if (error || !data) return { ok: false, error: 'That table could not be updated. Refresh and confirm the workspace is writable.' };
    return { ok: true, value: true };
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}
