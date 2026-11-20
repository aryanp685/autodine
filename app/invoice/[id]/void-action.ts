'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { GST_UUID } from '@/lib/gst/buyer';
import { validateNoteReason } from '@/lib/gst/notes';

export async function voidBillingDocumentAction(id: string, why: string): Promise<{ok: true} | {ok: false; error: string}> {
  if (typeof id !== 'string' || !GST_UUID.test(id)) return {ok:false,error:'Select a saved document.'};
  const reason = validateNoteReason(typeof why === 'string' ? why : null);
  if (!reason.ok) return reason;
  const staff = await getStaffContextDetailed();
  if (!staff.ok || staff.context.role !== 'owner' || !staff.context.entitlement?.canWrite) return {ok:false,error:'Only an entitled outlet owner can void this document.'};
  const { supabase,restaurantId } = staff.context;
  const { data, error } = await supabase.from('restaurant_invoices').select('id,status').eq('id',id).eq('restaurant_id',restaurantId).maybeSingle();
  if (error || data?.status !== 'issued') return {ok:false,error:'The document is no longer issued in the selected outlet.'};
  const { error: failed } = await supabase.rpc('void_restaurant_invoice',{p_invoice_id:id,p_reason:reason.reason});
  if (failed) return {ok:false,error:failed.message ?? 'The void was not recorded.'};
  for (const path of [`/invoice/${id}`,'/dashboard/invoices','/dashboard/reports/gst']) revalidatePath(path);
  return {ok:true};
}
