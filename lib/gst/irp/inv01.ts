/** Notified INV-01 / NIC 1.1 mapping for the supported domestic restaurant
 * subset. Only saved amounts; no e-way bill, RCM, SEZ or export payloads. */
import { checkGstin, GST_STATE_CODES } from '../gstin';
import { validIndianBillingDate } from '../onboarding';
import { fingerprint } from './fingerprint';
import type { IrpPayloadV1 } from './types';

const string = (value: unknown, min: number, max: number) => typeof value === 'string' && value.length >= min && value.length <= max;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rupees = (paise: number) => paise / 100;
const asPaise = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 999_999_999_999.99
  && Math.round(value * 100) / 100 === value ? Math.round(value * 100) : NaN;
// Round a rational unit price to a ₹0.001 tick
// without a binary floating-point tie deciding the wire value.
const unitPrice = (paise: number, qty: number) => {
  const n = BigInt(paise) * 10n, d = BigInt(qty);
  return Number((2n * n + d) / (2n * d)) / 1000;
};
const toDate = (date: string) => date.split('-').reverse().join('/');
const validDate = (value: unknown) => typeof value === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(value) && validIndianBillingDate(value.split('/').reverse().join('-'));
const DOC_NUMBER = /^[A-Z1-9][A-Z0-9/-]{0,15}$/;

export function mapInv01(p: IrpPayloadV1) {
  if (!p.buyer || p.supplyType !== 'B2B') throw new Error('INV-01 mapping supports ordinary domestic B2B only.');
  const address = (party: IrpPayloadV1['seller'] | NonNullable<IrpPayloadV1['buyer']>) => ({
    Gstin: party.gstin, LglNm: party.legalName, Addr1: party.address1,
    ...(party.address2 ? { Addr2: party.address2 } : {}), Loc: party.location, Pin: Number(party.pincode), Stcd: party.stateCode,
    ...(party.phone ? { Ph: party.phone.replace(/[ ()+.-]/g, '') } : {}), ...(party.email ? { Em: party.email } : {}),
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: p.documentType, No: p.documentNumber, Dt: toDate(p.issuedDate) },
    SellerDtls: address(p.seller),
    BuyerDtls: { ...address(p.buyer), Pos: p.placeOfSupplyStateCode },
    ItemList: p.lines.map((line, idx) => ({
      SlNo: String(idx + 1), PrdDesc: line.itemName, IsServc: 'Y', HsnCd: line.hsnSac, Qty: line.quantity,
      // Wire-unit precision, only. Per-line and document amounts are saved
      // integers; the exact paisa totals remain the accounting source.
      UnitPrice: unitPrice(line.grossAmountPaise, line.quantity),
      TotAmt: rupees(line.grossAmountPaise), Discount: rupees(line.discountPaise), AssAmt: rupees(line.taxablePaise),
      GstRt: line.rateBps / 100, CgstAmt: rupees(line.cgstPaise), SgstAmt: rupees(line.sgstPaise), IgstAmt: rupees(line.igstPaise),
      TotItemVal: rupees(line.totalItemValuePaise),
    })),
    ValDtls: { AssVal: rupees(p.values.taxablePaise), CgstVal: rupees(p.values.cgstPaise), SgstVal: rupees(p.values.sgstPaise),
      IgstVal: rupees(p.values.igstPaise), TotInvVal: rupees(p.values.totalPaise) },
    ...(p.originalInvoice ? { RefDtls: { PrecDocDtls: [{ InvNo: p.originalInvoice.documentNumber, InvDt: toDate(p.originalInvoice.issuedDate) }] } } : {}),
  };
}
export type Inv01 = ReturnType<typeof mapInv01>;

/** Validate the required notified fields and cross-field numeric rules for the
 * generated subset. A provider still validates portal masters/registration. */
export function validateInv01(value: unknown): string[] {
  const p = record(value), trans = record(p.TranDtls), doc = record(p.DocDtls), seller = record(p.SellerDtls), buyer = record(p.BuyerDtls);
  const errors: string[] = [];
  const field = (condition: unknown, path: string) => { if (!condition) errors.push(path); };
  field(p.Version === '1.1', 'Version');
  field(trans.TaxSch === 'GST' && trans.SupTyp === 'B2B' && trans.RegRev === 'N' && trans.IgstOnIntra === 'N' && !trans.EcmGstin && !p.ExpDtls && !p.EwbDtls, 'TranDtls');
  field(typeof doc.Typ === 'string' && ['INV','CRN','DBN'].includes(doc.Typ) && typeof doc.No === 'string' && DOC_NUMBER.test(doc.No) && validDate(doc.Dt), 'DocDtls');
  for (const [path, party] of [['SellerDtls', seller], ['BuyerDtls', buyer]] as const) {
    const gstin = typeof party.Gstin === 'string' && party.Gstin === party.Gstin.toUpperCase() ? checkGstin(party.Gstin) : null;
    field(gstin?.ok && gstin.parts.stateCode === party.Stcd, `${path}.Gstin/Stcd`);
    field(string(party.LglNm, 3, 100) && string(party.Addr1, 3, 100) && (party.Addr2 === undefined || string(party.Addr2, 3, 100))
      && string(party.Loc, 3, 50) && typeof party.Pin === 'number' && Number.isInteger(party.Pin) && party.Pin >= 100000 && party.Pin <= 999999, `${path}.Address`);
    field((party.Ph === undefined || typeof party.Ph === 'string' && /^\d{6,12}$/.test(party.Ph))
      && (party.Em === undefined || typeof party.Em === 'string' && party.Em.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(party.Em)), `${path}.Contact`);
  }
  field(seller.Stcd === buyer.Pos, 'BuyerDtls.Pos must match direct premises');
  field(typeof buyer.Pos === 'string' && GST_STATE_CODES.has(buyer.Pos), 'BuyerDtls.Pos');
  field(seller.Gstin !== buyer.Gstin, 'SellerDtls/BuyerDtls.Gstin');
  const intra = seller.Stcd === buyer.Pos;
  const sums = [0,0,0,0,0];
  const items = Array.isArray(p.ItemList) ? p.ItemList : [];
  field(items.length >= 1 && items.length <= 1000, 'ItemList');
  items.forEach((unknownItem, index) => {
    const item = record(unknownItem);
    const [ass,cgst,sgst,igst,total] = ['AssAmt','CgstAmt','SgstAmt','IgstAmt','TotItemVal'].map((k) => asPaise(item[k]));
    const base = `ItemList[${index}]`;
    field(item.SlNo === String(index+1) && string(item.PrdDesc,1,300) && item.IsServc === 'Y' && typeof item.HsnCd === 'string' && /^9963[0-9]{2}$/.test(item.HsnCd), `${base}.Service`);
    field(Number.isSafeInteger(item.Qty) && Number(item.Qty) > 0 && typeof item.UnitPrice === 'number' && item.UnitPrice >= 0 && item.UnitPrice <= 999_999_999_999.999
      && Math.abs(Math.round(item.UnitPrice * Number(item.Qty) * 100) - asPaise(item.TotAmt)) <= 100, `${base}.Qty/UnitPrice`);
    field(item.Discount === 0 && asPaise(item.TotAmt) === ass && ass + cgst + sgst + igst === total, `${base}.Amounts`);
    field((item.GstRt === 5 || item.GstRt === 18) && (intra ? igst === 0 : cgst === 0 && sgst === 0)
      && Math.abs(Math.round(ass * Number(item.GstRt) / 100) - (cgst+sgst+igst)) <= 100, `${base}.Tax`);
    [ass,cgst,sgst,igst,total].forEach((n,i) => { sums[i] += n; });
  });
  const totals = record(p.ValDtls);
  field(['AssVal','CgstVal','SgstVal','IgstVal','TotInvVal'].every((k,i) => asPaise(totals[k]) === sums[i]), 'ValDtls');
  const references = record(p.RefDtls).PrecDocDtls;
  if (doc.Typ === 'CRN' || doc.Typ === 'DBN') {
    const ref = record(Array.isArray(references) && references.length === 1 ? references[0] : null);
    field(typeof ref.InvNo === 'string' && DOC_NUMBER.test(ref.InvNo) && ref.InvNo !== doc.No && validDate(ref.InvDt), 'RefDtls.PrecDocDtls');
  } else {
    field(p.RefDtls === undefined, 'RefDtls');
  }
  return errors;
}

export function toValidatedInv01(payload: IrpPayloadV1) {
  const { fingerprintSha256, ...body } = payload;
  if (fingerprint(body) !== fingerprintSha256) throw new Error('Canonical payload fingerprint changed.');
  const request = mapInv01(payload);
  const errors = validateInv01(request);
  if (errors.length) throw new Error(`INV-01 1.1 validation failed: ${errors.slice(0,8).join(', ')}`);
  return request;
}
