import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ staff:vi.fn(), rpc:vi.fn(), revalidate:vi.fn() }));
vi.mock('@/lib/db/staff',()=>({CASHIER_ROLES:['owner','manager','cashier'],getStaffContextDetailed:mocks.staff}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw new Error(path);}}));
import { placeDirectTicketAction } from './actions';

const session='61000000-0000-4000-8000-000000000001';
const attempt='61000000-0000-4000-8000-000000000002';
const item='61000000-0000-4000-8000-000000000003';
const variant='61000000-0000-4000-8000-000000000004';
const context = (role='cashier',canWrite=true) => ({ok:true,context:{role,entitlement:{canWrite},restaurantId:'selected',supabase:{rpc:mocks.rpc}}});
function form(overrides:Record<string,string>={}) {
  const data = new FormData();
  for (const [key,value] of Object.entries({outlet:'selected',attempt,channel:'direct_delivery',attested:'on',state:'27',address:'1 Synthetic Private Lane',
    menuLine:`${item}:${variant}`,quantity:'2',...overrides})) data.set(key,value);
  return data;
}

describe('direct counter ticket action',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.staff.mockResolvedValue(context());mocks.rpc.mockResolvedValue({data:session,error:null});});

  it('passes the verified outlet, attempt and menu selections; never a client amount or tax',async()=>{
    await expect(placeDirectTicketAction(null,form({taxRate:'0',pricePaise:'1',restaurantId:'other'}))).rejects.toThrow(`/dashboard#session-${session}`);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('place_gst_direct_ticket',{p_outlet:'selected',p_attempt:attempt,p_channel:'direct_delivery',
      p_lines:[{item_id:item,variant_id:variant,qty:2}],p_attested:true,p_delivery_state:'27',p_delivery_address:'1 Synthetic Private Lane'});
    expect(mocks.revalidate).toHaveBeenCalledWith('/dashboard');
  });

  it('refuses missing membership, wrong role, a stale outlet and unsupported or malformed selections',async()=>{
    mocks.staff.mockResolvedValueOnce({ok:false,reason:'no-membership'}).mockResolvedValueOnce(context('kitchen')).mockResolvedValueOnce(context('owner',false));
    for (let i=0;i<3;i++) expect(await placeDirectTicketAction(null,form())).toHaveProperty('error');
    const invalid: Record<string,string>[] = [{outlet:'other'},{attempt:'bad'},{channel:'marketplace'},{attested:''},
      {state:'97'},{address:'Too'},{quantity:'101'},{menuLine:`${item}:${variant}:bad`}];
    for (const patch of invalid) {
      expect(await placeDirectTicketAction(null,form(patch))).toHaveProperty('error');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps a rejected submission on the form without exposing the private RPC message',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'23514',message:'private synthetic destination'}});
    const result = await placeDirectTicketAction(null,form());
    expect(result?.error).toMatch(/Only direct same-state/i);
    expect(result?.error).not.toContain('private synthetic destination');
    expect(mocks.revalidate).not.toHaveBeenCalled();
    await expect(placeDirectTicketAction(result,form())).rejects.toThrow(`/dashboard#session-${session}`);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });
});
