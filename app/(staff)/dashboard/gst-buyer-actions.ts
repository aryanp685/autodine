'use server';

import { CASHIER_ROLES, getStaffContextDetailed } from '@/lib/db/staff';
import { normalizeCheckoutRecipient, type BuyerFields, type SavedGstBuyer } from '@/lib/gst/buyer';

export async function findGstBuyersAction(prefix: string): Promise<{ ok: true; rows: SavedGstBuyer[] } | { ok: false; error: string }> {
  const search = typeof prefix === 'string' ? prefix.trim().toUpperCase() : '';
  if (!/^[0-9A-Z]{3,15}$/.test(search)) return { ok: false, error: 'Enter at least three characters of the buyer GSTIN.' };
  const staff = await getStaffContextDetailed();
  if (!staff.ok || !CASHIER_ROLES.includes(staff.context.role)) return { ok: false, error: 'Sign in to view buyers at this outlet.' };
  const { data, error } = await staff.context.supabase.from('restaurant_gst_buyers').select('id,revision,details')
    .eq('restaurant_id', staff.context.restaurantId).like('gstin', `${search}%`).order('gstin').limit(20);
  if (error) return { ok: false, error: 'Saved buyers are unavailable.' };
  return { ok: true, rows: (data ?? []).map((b) => ({ id: b.id, revision: b.revision, details: b.details as BuyerFields })) };
}

export async function saveGstBuyerAction(outletId: string, revision: number, details: BuyerFields): Promise<
  { ok: true; buyer: SavedGstBuyer } | { ok: false; error: string }> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok || staff.context.role !== 'owner' || !staff.context.entitlement?.canWrite || staff.context.restaurantId !== outletId) {
    return { ok: false, error: 'Only an entitled owner of the selected outlet can save buyers.' };
  }
  if (!Number.isInteger(revision) || revision < 0 || revision >= 1_000_000_000 || !details || typeof details !== 'object') {
    return { ok: false, error: 'Reload the buyer before saving.' };
  }
  const checked = normalizeCheckoutRecipient({ name: details.name, gstin: details.gstin, address: details.address,
    location: details.location, pincode: details.pincode, state_code: details.state_code, phone: details.phone, email: details.email }, true);
  if (!checked.ok) return checked;
  const { data, error } = await staff.context.supabase.rpc('save_restaurant_gst_buyer', {
    p_outlet: staff.context.restaurantId, p_expected_revision: revision, p_details: checked.data,
  });
  if (error || !data) return { ok: false, error: error?.code === 'P0001'
    ? 'Buyer exists or changed, or this outlet is read-only. Reload before saving.' : 'Could not save buyer.' };
  return { ok: true, buyer: data as SavedGstBuyer };
}
