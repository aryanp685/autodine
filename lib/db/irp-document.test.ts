import QRCode from 'qrcode';
import { describe, expect, it, vi } from 'vitest';
import type { StaffContext } from './staff';
import { readPrivateIrpCopy } from './irp-document';

const outlet='80000000-0000-4000-8000-000000000001';
const source='80000000-0000-4000-8000-000000000002';
const data={tier:'authority',reference:'a'.repeat(64),number:'9007199254740993123',at:'2026-11-18T12:00:00Z',qr:'eyJhbGciOiJSUzI1NiJ9.e30.Zml4dHVyZQ'};
const mock=(value:unknown,error:unknown=null)=>{
  const rpc=vi.fn().mockResolvedValue({data:value,error});
  return {rpc,staff:{restaurantId:outlet,supabase:{rpc}} as unknown as StaffContext};
};

describe('private IRP document copy',()=>{
  it('packs only an authority projection into the exact signed QR PNG, with lossless ACK number',async()=>{
    const {staff,rpc}=mock(data);
    expect(await readPrivateIrpCopy(staff,source,'invoice')).toEqual({tier:'authority',reference:data.reference,
      acknowledgement:data.number,acknowledgedAt:data.at,
      qrImage:await QRCode.toDataURL(data.qr,{errorCorrectionLevel:'L',type:'image/png',margin:4,scale:5})});
    expect(rpc).toHaveBeenCalledWith('read_active_irp_document',{p_outlet:outlet,p_document:source,p_kind:'invoice'});
  });
  it('fails closed on missing, malformed, simulated or denied copy',async()=>{
    const ref='80000000-0000-4000-8000-000000000003';
    for (const value of [null,{irn:data.reference,status:'generated'},{...data,number:Number(data.number)},
      {...data,qr:'https://example.invalid'},{...data,tier:'simulation',reference:`SIM-${ref}`,number:`SIM-ACK-${ref}`}]) {
      expect(await readPrivateIrpCopy(mock(value).staff,source,'note')).toBeNull();
    }
    expect(await readPrivateIrpCopy(mock(data,{code:'42501'}).staff,source,'invoice')).toBeNull();
  });
});
