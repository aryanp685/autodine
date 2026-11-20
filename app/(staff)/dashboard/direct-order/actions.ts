'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { CASHIER_ROLES, getStaffContextDetailed } from '@/lib/db/staff';
import { GST_OUTLET_STATES } from '@/lib/gst/onboarding';

const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export type DirectTicketResult = { error: string } | null;
const fail = (error: string): DirectTicketResult => ({ error });

export async function placeDirectTicketAction(_previous: DirectTicketResult, form: FormData): Promise<DirectTicketResult> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return fail('Sign in to record a direct ticket.');
  const { supabase, role, restaurantId, entitlement } = staff.context;
  if (!CASHIER_ROLES.includes(role) || !entitlement?.canWrite) return fail('This outlet is read-only or the account does not have counter access.');
  const read = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };
  if (read('outlet') !== restaurantId) return fail('The outlet changed. Reload the form before recording a ticket.');
  const channel = read('channel'), attempt = read('attempt');
  if (!UUID.test(attempt) || !['takeaway','direct_delivery'].includes(channel) || read('attested') !== 'on') {
    return fail('Select takeaway or same-state delivery and confirm direct restaurant service.');
  }
  const state = read('state'), address = read('address');
  if (channel === 'direct_delivery' && (!Object.hasOwn(GST_OUTLET_STATES,state) || address.length < 5 || address.length > 180 || /[\u0000-\u001f\u007f]/u.test(address))) {
    return fail('Enter the actual local delivery address and destination state, not the buyer GSTIN state.');
  }
  const choices = form.getAll('menuLine'), quantities = form.getAll('quantity');
  if (choices.length !== quantities.length || choices.length > 30) return fail('Enter up to 30 menu lines.');
  const lines: Array<{item_id:string; qty:number; variant_id?:string}> = [];
  for (const [i, choice] of choices.entries()) {
    if (choice === '') continue;
    if (typeof choice !== 'string' || typeof quantities[i] !== 'string') return fail('Choose a listed menu item and quantity.');
    const [item, variant, extra] = choice.split(':');
    const qty = quantities[i] as string;
    if (extra !== undefined || !UUID.test(item) || (variant !== undefined && !UUID.test(variant)) || !/^[1-9]\d?$/.test(qty)) {
      return fail('Choose a listed item or variant and a quantity from 1 to 99.');
    }
    lines.push({item_id:item,qty:Number(qty),...(variant ? {variant_id:variant} : {})});
  }
  if (!lines.length) return fail('Choose at least one menu item.');
  const { data, error } = await supabase.rpc('place_gst_direct_ticket', {
    p_outlet:restaurantId,p_attempt:attempt,p_channel:channel,p_lines:lines,p_attested:true,
    ...(channel === 'direct_delivery' ? {p_delivery_state:state,p_delivery_address:address} : {}),
  });
  if (error || typeof data !== 'string' || !UUID.test(data)) {
    // Do not echo a SQL error that may include personal address/row data.
    return fail(error?.code === '23514'
      ? 'Check the selected items, destination and order attempt. Only direct same-state service is supported, without discounts, extra charges or unclassified items.'
      : error?.code === 'P0001' ? 'Review the outlet billing profile or menu. Regular delivery requires current PAN review clearing IRN before accepting payment.'
      : 'Could not confirm the ticket. Check active billing sessions before creating another.');
  }
  for (const path of ['/dashboard','/cashier','/kitchen']) revalidatePath(path);
  redirect(`/dashboard#session-${data}`);
}
