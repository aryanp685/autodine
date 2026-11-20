import { getStaffContextDetailed } from '@/lib/db/staff';
import { irpRegisterCsv, loadIrpRegister, parseIrpFilters } from '@/lib/db/irp-register';

const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const failure=(message:string,status:number)=>Response.json({error:message},{status,headers});
export async function GET(request:Request) {
  try {
    const s=await getStaffContextDetailed();
    if (!s.ok) return failure('Sign in and select an authorized outlet.',s.reason==='signed-out'?401:s.reason==='unconfigured'?503:403);
    if (s.context.role!=='owner'&&s.context.role!=='manager') return failure('Owner or Manager permission is required.',403);
    const p=new URL(request.url).searchParams;
    if (p.get('outlet')!==s.context.restaurantId) return failure('The selected outlet changed. Reload the register.',409);
    const filters=parseIrpFilters(p);
    if (!filters) return failure('Enter a valid India date range of at most 366 days.',400);
    const list=await loadIrpRegister(s.context,filters,true);
    if (!list) return failure('IRP register unavailable.',503);
    if (list.total>10_000) return failure('Too many rows. Select a shorter date range.',422);
    if (list.total!==list.rows.length) return failure('The export is incomplete. No CSV was returned.',503);
    return new Response('\uFEFF'+irpRegisterCsv(list.rows),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="autodine-irp-register-${list.asOf}.csv"`}});
  } catch { return failure('IRP register unavailable.',503); }
}
