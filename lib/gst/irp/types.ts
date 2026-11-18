/**
 * Provider-agnostic types for e-Invoice (IRP/GSP) integration.
 *
 * AutoDine does NOT call a live IRP/GSP in this build. The only
 * implementation of IrpAdapter that exists is the offline sandbox stub in
 * ./sandbox.ts, used by tests and acceptance rehearsals. A production
 * provider must be selected, contracted and approved by the owner before a
 * real adapter is wired in — and credentials must never live in the repo or
 * the database.
 */

export type IrpDocumentKind = 'INV' | 'CRN' | 'DBN';
export type IrpSupplyType = 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'DEXP';
export type IrpPosKind = 'B2B' | 'B2CL' | 'B2CS';
export type IrpRecipientType = 'B' | 'C';

export type IrpSeller = {
  gstin: string;
  legalName: string;
  tradeName: string | null;
  address1: string;
  address2: string | null;
  location: string;
  pincode: string;
  stateCode: string;
  email: string | null;
  phone: string | null;
};

export type IrpRecipient = {
  gstin: string;
  legalName: string;
  address1: string;
  address2: string | null;
  location: string;
  pincode: string;
  stateCode: string;
  email: string | null;
  phone: string | null;
  placeOfSupplyStateCode: string;
};

export type IrpLine = {
  itemName: string;
  hsnSac: string;
  quantity: number;
  uom: 'NOS';
  /** Tax-exclusive unit price in paise. */
  unitPricePaise: number;
  grossAmountPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Rate in basis points on the taxable value, e.g. 500 = 5%. */
  rateBps: number;
  totalItemValuePaise: number;
};

export type IrpValues = {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  otherChargesPaise: number;
  totalPaise: number;
};

/** Versioned AutoDine IRP payload — deterministic for identical inputs. */
export type IrpPayloadV1 = {
  schemaVersion: 'autodine.irp.v1';
  documentType: IrpDocumentKind;
  documentNumber: string;
  /** ISO-8601 date (YYYY-MM-DD) in the issuing outlet's local date. */
  issuedDate: string;
  /**
   * Credit/debit notes only: the immutable source document they adjust.
   * Present iff documentType is 'CRN' | 'DBN'. INV payloads never carry it.
   */
  originalInvoice?: { documentType: 'INV'; documentNumber: string; issuedDate: string };
  supplyType: IrpSupplyType;
  posKind: IrpPosKind;
  recipientType: IrpRecipientType;
  placeOfSupplyStateCode: string;
  seller: IrpSeller;
  buyer: IrpRecipient | null;
  lines: IrpLine[];
  values: IrpValues;
  /** SHA-256 hex of the canonical serialization of everything above. */
  fingerprintSha256: string;
};

export type IrpCancelReason = '1' | '2' | '3' | '4';
export const IRP_CANCEL_REASONS: Record<IrpCancelReason, string> = {
  '1': 'Duplicate',
  '2': 'Data entry mistake',
  '3': 'Order cancelled',
  '4': 'Others',
};

/** Successful IRN acknowledgement from the IRP. */
export type IrpAck = {
  irn: string;
  ackNo: number;
  ackDateIso: string;
  /** Base64 payload of the signed QR code the printed invoice must carry. */
  signedQrCode: string;
  /** Base64 signed invoice document (JWS-like) as returned by the IRP. */
  signedInvoice: string;
};

export type IrpOutcome =
  | { ok: true; ack: IrpAck }
  | { ok: false; code: string; message: string };

export type IrpCancelOutcome =
  | { ok: true; cancelDateIso: string }
  | { ok: false; code: string; message: string };

export interface IrpAdapter {
  /** Stable provider identity recorded on every restaurant_irp_requests row. */
  readonly providerId: string;
  /** Passwordless, credential-free surface; creds are bound at construction. */
  generateIrn(payload: IrpPayloadV1): Promise<IrpOutcome>;
  cancelIrn(input: { irn: string; reason: IrpCancelReason; remark: string }): Promise<IrpCancelOutcome>;
}
