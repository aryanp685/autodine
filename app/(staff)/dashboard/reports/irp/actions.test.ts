import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueIrpDispatch, requestIrpAction, selectIrpRoute } from './actions';
import { GET } from './export/route';
import { IRP_REGISTER_PATH as path } from '@/lib/db/irp-register';

const mocks=vi.hoisted(()=>({staff:vi.fn(),rpc:vi.fn(),local:vi.fn(),refresh:vi.fn()}));
vi.mock('@/lib/db/staff',()=>({getStaffContextDetailed:mocks.staff}));
vi.mock('@/lib/gst/adapter',()=>({isLocalIrpSimulation:mocks.local}));
vi.mock('next/cache',()=>({revalidatePath:mocks.refresh}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw new Error(path);}}));
const a='80000000-0000-4000-8000-000000000001', b='80000000-0000-4000-8000-000000000002';
const id='80000000-0000-4000-8000-000000000003', source='80000000-0000-4000-8000-000000000004';
const form=(fields:Record<string,string>)=>{ const f=new FormData(); for (const [k,v] of Object.entries(fields)) f.set(k,v); return f; };
const staff=(role='owner',canWrite=true)=>mocks.staff.mockResolvedValue({ok:true,context:{restaurantId:a,role,entitlement:{canWrite},supabase:{rpc:mocks.rpc}}});
const request=(params:string)=>new Request(`https://not-an-origin.invalid${path}/export?${params}`);
beforeEach(()=>{vi.resetAllMocks();staff();mocks.local.mockReturnValue(true);});

describe('IRP owner requests',()=>{
  it('refuses simulation in a deployed or non-opted-in environment before requesting data',async()=>{
    mocks.local.mockReturnValue(false);
    await expect(queueIrpDispatch(form({outlet:a,preflight:id}))).rejects.toThrow('notice=disabled');
    expect(mocks.staff).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('denies managers, read-only owners and stale outlet forms',async()=>{
    for (const [role,canWrite] of [['manager',true],['owner',false]] as const) {
      staff(role,canWrite);
      await expect(selectIrpRoute(form({outlet:a,route:id,revision:'0'}))).rejects.toThrow('notice=denied');
    }
    staff();
    await expect(queueIrpDispatch(form({outlet:b,preflight:id}))).rejects.toThrow('notice=outlet');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('sends only route id and expected revision; exposes no credentials or worker call',async()=>{
    mocks.rpc.mockResolvedValue({data:4});
    await expect(selectIrpRoute(form({outlet:a,route:id,revision:'3',endPoint:'ignored'}))).rejects.toThrow('notice=saved');
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('choose_irp_route',{p_outlet:a,p_route:id,p_revision:3});
  });
  it('rejects forged success, strictly validates cancellation reason and redacts stale/rejection details',async()=>{
    await expect(requestIrpAction(form({outlet:a,dispatch:id,operation:'verified',revision:'3'}))).rejects.toThrow('notice=invalid');
    await expect(requestIrpAction(form({outlet:a,dispatch:id,operation:'cancel',reason:'free text',revision:'3'}))).rejects.toThrow('notice=invalid');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({error:{code:'40001',message:'private detail'}});
    await expect(requestIrpAction(form({outlet:a,dispatch:id,operation:'cancel',reason:'3',revision:'3'}))).rejects.toThrow(`${path}/${id}?notice=stale`);
    expect(mocks.rpc).toHaveBeenCalledWith('request_irp_dispatch_action',{p_outlet:a,p_job:id,p_action:'cancel',p_reason:'3',p_revision:3});
  });
});
describe('IRP CSV route',()=>{
  it('pins selected outlet and date bounds, never returning partial export or a forged outlet',async()=>{
    expect((await GET(request(`outlet=${b}`))).status).toBe(409);
    expect((await GET(request(`outlet=${a}&from=2026-12-03&to=2026-11-01`))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({data:{outlet:a,as_of_india:'2026-11-18',total:2,rows:[]}});
    expect((await GET(request(`outlet=${a}`))).status).toBe(503);
    mocks.rpc.mockResolvedValue({data:{outlet:a,as_of_india:'2026-11-18',total:10_001,rows:[]}});
    expect((await GET(request(`outlet=${a}`))).status).toBe(422);
  });
  it('escapes spreadsheet formulas and excludes signed or taxpayer material from a manager export',async()=>{
    staff('manager');
    mocks.rpc.mockResolvedValue({data:{outlet:a,as_of_india:'2026-11-18',total:1,rows:[{
      id,document_id:source,kind:'invoice',issue_date:'2026-11-18',tier:'simulation',phase:'ambiguous',verified_active:true,
      number:'\t=FORMULA()',copy:'PRIVATE-ARTEFACT',request_payload:{private:'TAXPAYER'},
    }]}});
    const csv=await GET(request(`outlet=${a}&from=2026-11-18&to=2026-11-18&queue=1&page=2`));
    expect(csv.status).toBe(200); expect(csv.headers.get('cache-control')).toContain('no-store');
    const body=await csv.text();
    expect(body).toContain('"\'\t=FORMULA()"'); expect(body).toContain('"ambiguous","no"');
    expect(body).not.toMatch(/TAXPAYER|PRIVATE-ARTEFACT/);
    expect(mocks.rpc).toHaveBeenCalledWith('report_irp_register',{p_outlet:a,p_from:'2026-11-18',p_until:'2026-11-19',p_limit:10000,p_offset:0,p_followup:true});
  });
});
