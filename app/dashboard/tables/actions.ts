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
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Table management is not configured.');
  return { ...access, admin };
}

export async function createDiningTableAction(slug: string, labelValue: string, seatsValue: number): Promise<ActionResult<DiningTable>> {
  try {
    const { workspace, admin } = await requireTableManager(slug);
    const label = labelValue.trim().replace(/\s+/g, ' ');
    const seats = Math.trunc(seatsValue);
    if (!label || label.length > 32 || !Number.isInteger(seats) || seats < 1 || seats > 30) {
      return { ok: false, error: 'Enter a table label (1–32 characters) and 1–30 seats.' };
    }
    const { data, error } = await admin
      .from('dining_tables')
      .insert({ restaurant_id: workspace.id, label, seats, is_active: true })
      .select('id, restaurant_id, label, seats, is_active')
      .single();
    if (error || !data) return { ok: false, error: 'Could not create that table. Check that its label is unique.' };
    return { ok: true, value: data };
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}

export async function issueTableQrAction(slug: string, tableId: string): Promise<ActionResult<TableQr>> {
  try {
    const { workspace, userId, admin } = await requireTableManager(slug);
    const { data: table, error: tableError } = await admin
      .from('dining_tables')
      .select('id, restaurant_id, is_active')
      .eq('id', tableId)
      .eq('restaurant_id', workspace.id)
      .maybeSingle();
    if (tableError || !table || !table.is_active) return { ok: false, error: 'That active table could not be found in this workspace.' };

    const publicToken = randomBytes(32).toString('base64url');
    const { data, error } = await admin.rpc('issue_table_qr_code', {
      p_restaurant_id: workspace.id,
      p_table_id: table.id,
      p_public_token: publicToken,
      p_actor_id: userId,
    });
    if (error || !data) return { ok: false, error: 'Could not issue a table QR code.' };
    return { ok: true, value: data };
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}

export async function revokeTableQrAction(slug: string, qrCodeId: string): Promise<ActionResult<boolean>> {
  try {
    const { workspace, admin } = await requireTableManager(slug);
    const { data, error } = await admin.rpc('revoke_table_qr_code', {
      p_restaurant_id: workspace.id,
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
    const { workspace, admin } = await requireTableManager(slug);
    const { data, error } = await admin
      .from('dining_tables')
      .update({ is_active: isActive })
      .eq('id', tableId)
      .eq('restaurant_id', workspace.id)
      .select('id')
      .maybeSingle();
    if (error || !data) return { ok: false, error: 'That table could not be updated.' };
    return { ok: true, value: true };
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}
