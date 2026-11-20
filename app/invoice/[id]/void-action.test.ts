import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ staff:vi.fn(), select:vi.fn(), scope:vi.fn(), rpc:vi.fn(), revalidate:vi.fn() }));
vi.mock('@/lib/db/staff', () => ({ getStaffContextDetailed:mocks.staff }));
vi.mock('next/cache', () => ({ revalidatePath:mocks.revalidate }));

import { voidBillingDocumentAction } from './void-action';

const document = 'dfcd261d-8c6d-4050-aa82-717d92641573';
const outlet = '3b8cea6e-d761-45b5-aeae-ece5f4cb60bd';
const setStaff = (role: string, canWrite: boolean) => mocks.staff.mockResolvedValue({ok:true,context:{role,restaurantId:outlet,entitlement:{canWrite},supabase:{
  from:() => ({select:() => ({eq:() => ({eq:(key: string,value: string) => {
    mocks.scope(key,value);
    return {maybeSingle:mocks.select};
  }})})}), rpc:mocks.rpc,
}}});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockResolvedValue({data:{ id:document, status:'issued' },error:null});
  mocks.rpc.mockResolvedValue({error:null});
});

it('requires an entitled owner and a reason for a local void', async () => {
  for (const [role,canWrite] of [['owner',false],['manager',true],['cashier',true]] as const) {
    setStaff(role,canWrite);
    expect(await voidBillingDocumentAction(document,'Local duplicate bill')).toMatchObject({ok:false});
  }
  setStaff('owner',true);
  expect(await voidBillingDocumentAction(document,'  ')).toMatchObject({ok:false});
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('binds void to an issued document in the selected outlet; only the void RPC can mutate', async () => {
  setStaff('owner',true);
  mocks.select.mockResolvedValueOnce({data:null,error:null});
  expect(await voidBillingDocumentAction(document,'Local duplicate bill')).toMatchObject({ok:false});
  expect(mocks.scope).toHaveBeenCalledWith('restaurant_id',outlet);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(await voidBillingDocumentAction(document,' Local duplicate bill ')).toEqual({ok:true});
  expect(mocks.rpc.mock.calls).toEqual([['void_restaurant_invoice',{p_invoice_id:document,p_reason:'Local duplicate bill'}]]);
  expect(mocks.revalidate).toHaveBeenCalledWith(`/invoice/${document}`);
});

it('does not interpret a refused void as an IRP cancellation or success', async () => {
  setStaff('owner',true);
  mocks.rpc.mockResolvedValue({error:{message:'Reconcile the IRP status before local void.'}});
  expect(await voidBillingDocumentAction(document,'Correction noted')).toEqual({ok:false,error:'Reconcile the IRP status before local void.'});
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
