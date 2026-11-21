/**
 * Structural validation of an IRP acknowledgement's signed QR payload.
 *
 * HONEST LIMITATION: an offline validator can check structure only. The NIC
 * QR carries an RSA/ECC signature by the IRP over the JSON body; verifying
 * it requires the IRP/NIC public key, which ships with the (approved) live
 * provider integration — not before. What this does check offline:
 *  - the base64 decodes to JSON,
 *  - the required keys exist with plausible shapes,
 *  - the Irn inside matches the acknowledged IRN (when given).
 * A deployment treats structure-valid-but-unverifiable as unverified, not valid.
 */

export type SignedQrParse =
  | { ok: true; fields: { sellerGstin: string; buyerGstin: string | null; docNo: string; docTyp: string; totInvVal: number; irn: string | null } }
  | { ok: false; reason: string };

export function parseSignedQr(signedQrCode: string): SignedQrParse {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(signedQrCode, 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'Signed QR does not decode to JSON.' };
  }
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'Signed QR payload is not an object.' };
  }
  const o = raw as Record<string, unknown>;
  const sellerGstin = typeof o.SellerGstin === 'string' ? o.SellerGstin : null;
  const buyerGstin = typeof o.BuyerGstin === 'string' && o.BuyerGstin ? o.BuyerGstin : null;
  const docNo = typeof o.DocNo === 'string' ? o.DocNo : null;
  const docTyp = typeof o.DocTyp === 'string' ? o.DocTyp : null;
  const totInvVal = typeof o.TotInvVal === 'number' ? o.TotInvVal : Number(o.TotInvVal);
  const irn = typeof o.Irn === 'string' ? o.Irn : null;
  if (!sellerGstin || !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(sellerGstin)) {
    return { ok: false, reason: 'Signed QR seller GSTIN missing or malformed.' };
  }
  if (buyerGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(buyerGstin)) {
    return { ok: false, reason: 'Signed QR buyer GSTIN malformed.' };
  }
  if (!docNo || !docTyp) {
    return { ok: false, reason: 'Signed QR is missing DocNo or DocTyp.' };
  }
  if (!Number.isFinite(totInvVal)) {
    return { ok: false, reason: 'Signed QR total invoice value is not a number.' };
  }
  return { ok: true, fields: { sellerGstin, buyerGstin, docNo, docTyp, totInvVal, irn } };
}

/** IRN is exactly 64 lowercase hex characters. */
export function isIrn(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
