import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/db/staff',()=>({getStaffContextDetailed:m.staff}));
import { authorizeTts } from './tts-access';
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue({ok:true,context:{restaurantId:'tenant',supabase:{rpc:m.rpc}}});m.rpc.mockResolvedValue({data:[{allowed:true,retry_after_seconds:0}],error:null});});
describe('staff-only distributed TTS gate',()=>{
  it.each([['signed-out',401],['no-membership',403],['unconfigured',503]])('denies %s without spending provider work',async(reason,status)=>{
    m.staff.mockResolvedValue({ok:false,reason});expect((await authorizeTts())?.status).toBe(status);expect(m.rpc).not.toHaveBeenCalled();
  });
  it('reserves budget only for the server-resolved restaurant',async()=>{
    expect(await authorizeTts()).toBeNull();expect(m.rpc).toHaveBeenCalledWith('reserve_staff_tts_attempt',{p_restaurant_id:'tenant'});
  });
  it('returns 429 and a bounded retry hint when shared quota is exhausted',async()=>{
    m.rpc.mockResolvedValue({data:[{allowed:false,retry_after_seconds:90}],error:null});const response=await authorizeTts();expect(response?.status).toBe(429);expect(response?.headers.get('retry-after')).toBe('90');
  });
  it.each([{data:null,error:{message:'private DB detail'}},{data:[],error:null}])('fails closed on absent/broken budget',async result=>{
    m.rpc.mockResolvedValue(result);const response=await authorizeTts();expect(response?.status).toBe(503);expect(await response?.text()).not.toContain('private DB detail');
  });
  it('fails closed when auth throws',async()=>{m.staff.mockRejectedValue(new Error('cookie failure'));expect((await authorizeTts())?.status).toBe(503);});
});
