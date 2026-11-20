import QRCode from 'qrcode';
import type { StaffContext } from './staff';
import { parseIrpCopy } from './irp-register';
import type { VerifiedIrpCopy } from '@/lib/gst/irp/execution/presentation';

/** Private print view only. QR is an exact rendering of the signed string,
 * not a payment QR, a URL, or an unsigned reconstruction of its payload. */
export async function readPrivateIrpCopy(staff:StaffContext, id:string, kind:'invoice'|'note'):Promise<VerifiedIrpCopy|null> {
  try {
    const {data,error}=await staff.supabase.rpc('read_active_irp_document',{p_outlet:staff.restaurantId,p_document:id,p_kind:kind});
    const copy=error?null:parseIrpCopy(data);
    if (copy?.tier!=='authority') return null;
    const qrImage=await QRCode.toDataURL(copy.qr,{errorCorrectionLevel:'L',type:'image/png',margin:4,scale:5});
    return {tier:'authority',reference:copy.reference,acknowledgement:copy.acknowledgement,acknowledgedAt:copy.acknowledgedAt,qrImage};
  } catch { return null; }
}
