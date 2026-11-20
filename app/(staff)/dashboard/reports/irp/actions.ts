'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { IRP_REGISTER_PATH } from '@/lib/db/irp-register';
import { GST_UUID } from '@/lib/gst/buyer';
import { isLocalIrpSimulation } from '@/lib/gst/adapter';

const uuid = (v:FormDataEntryValue|null):v is string => typeof v==='string'&&GST_UUID.test(v);
const revision = (v:FormDataEntryValue|null) => typeof v==='string'&&/^(0|[1-9][0-9]{0,8})$/.test(v)?Number(v):null;
const failure = (code:string, path=IRP_REGISTER_PATH):never => redirect(`${path}?notice=${code}`);
async function owner(form:FormData) {
  if (!isLocalIrpSimulation()) failure('disabled');
  const staff=await getStaffContextDetailed();
  if (!staff.ok || staff.context.role!=='owner' || staff.context.entitlement?.canWrite!==true) return failure('denied');
  if (form.get('outlet')!==staff.context.restaurantId) return failure('outlet');
  return staff.context;
}
export async function selectIrpRoute(form:FormData) {
  const staff=await owner(form), route=form.get('route'), rev=revision(form.get('revision'));
  if (rev===null || (route!==''&&!uuid(route))) return failure('invalid');
  const {data,error}=await staff.supabase.rpc('choose_irp_route',{p_outlet:staff.restaurantId,p_route:route||null,p_revision:rev});
  if (error || data!==rev+1) return failure(error?.code==='40001'?'stale':'rejected');
  revalidatePath(IRP_REGISTER_PATH);
  redirect(`${IRP_REGISTER_PATH}?notice=saved`);
}
export async function queueIrpDispatch(form:FormData) {
  const staff=await owner(form), preflight=form.get('preflight');
  if (!uuid(preflight)) return failure('invalid');
  const {data,error}=await staff.supabase.rpc('queue_irp_dispatch',{p_outlet:staff.restaurantId,p_preflight:preflight});
  if (error || !data || !GST_UUID.test(data)) return failure('rejected');
  revalidatePath(IRP_REGISTER_PATH);
  redirect(`${IRP_REGISTER_PATH}/${data}?notice=queued`);
}
export async function requestIrpAction(form:FormData) {
  const staff=await owner(form), id=form.get('dispatch'), action=form.get('operation'), reason=form.get('reason'), rev=revision(form.get('revision'));
  if (!uuid(id) || rev===null || (action!=='cancel'&&action!=='lookup'&&action!=='retry') || (action==='cancel'
    ? typeof reason!=='string'||!['1','2','3','4'].includes(reason) : reason!==null)) return failure('invalid');
  const path=`${IRP_REGISTER_PATH}/${id}`;
  const {data,error}=await staff.supabase.rpc('request_irp_dispatch_action',{p_outlet:staff.restaurantId,p_job:id,p_revision:rev,p_action:action,
    ...(typeof reason==='string'?{p_reason:reason}:{})});
  if (error || data!==rev+1) return failure(error?.code==='40001'?'stale':'rejected',path);
  revalidatePath(IRP_REGISTER_PATH);
  redirect(`${path}?notice=queued`);
}
