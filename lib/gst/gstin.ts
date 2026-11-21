/**
 * GSTIN validation.
 *
 * A GSTIN is 15 characters: 2-digit state code + 10-char PAN + 1 entity
 * number + literal 'Z' + 1 checksum character. This module verifies the
 * FORMAT and the CHECKSUM (GSTN's documented Mod-36 algorithm) and extracts
 * the state code and PAN. It does NOT know whether the GSTIN is actually
 * registered — only the GST portal/IRP can say that. Every UI that displays
 * "verified" must say "format and checksum valid", never "valid registration".
 */

export const GSTIN_LENGTH = 15;
const MAP = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Valid GST state codes (01–38). */
export const GST_STATE_CODES = new Set([...Array(38)].map((_, i) => String(i + 1).padStart(2, '0')));

export type GstinParts = { stateCode: string; pan: string; entity: string; checksum: string };
export type GstinCheck = { ok: true; parts: GstinParts } | { ok: false; reason: string };

export function checkGstin(raw: string | null | undefined): GstinCheck {
  if (!raw) return { ok: false, reason: 'GSTIN is empty.' };
  const gstin = raw.trim().toUpperCase();
  if (gstin.length !== GSTIN_LENGTH) return { ok: false, reason: `GSTIN must be 15 characters, got ${gstin.length}.` };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return { ok: false, reason: 'GSTIN does not match the 2-digit state + PAN + entity + Z + checksum layout.' };
  }
  const stateCode = gstin.slice(0, 2);
  if (!GST_STATE_CODES.has(stateCode)) return { ok: false, reason: `State code ${stateCode} is not a GST state code.` };
  // Checksum: right-to-left, alternating factors 2 and 1 starting with 2 at position 13, Mod-36.
  let factor = 2, sum = 0;
  for (let i = 13; i >= 0; i -= 1) {
    const code = MAP.indexOf(gstin[i]);
    let digit = factor * code;
    digit = Math.floor(digit / 36) + (digit % 36);
    sum += digit;
    factor = factor === 2 ? 1 : 2;
  }
  const expected = MAP[(36 - (sum % 36)) % 36];
  if (gstin[14] !== expected) return { ok: false, reason: 'GSTIN checksum does not match (expected check character ' + expected + ').' };
  return { ok: true, parts: { stateCode, pan: gstin.slice(2, 12), entity: gstin[12], checksum: gstin[14] } };
}

export function gstinStateCode(raw: string): string | null {
  const c = checkGstin(raw);
  return c.ok ? c.parts.stateCode : null;
}

export function gstinPan(raw: string): string | null {
  const c = checkGstin(raw);
  return c.ok ? c.parts.pan : null;
}

/** The PAN must match the GSTIN's embedded PAN — a classic cross-registration error. */
export function panMatchesGstin(pan: string, gstin: string): boolean {
  const c = checkGstin(gstin);
  if (!c.ok) return false;
  return c.parts.pan === pan.trim().toUpperCase();
}

/**
 * Cross-registration consistency for one legal person (one PAN): every GSTIN
 * under the same PAN must agree on composition vs regular status; mixing both
 * under one PAN is not permitted. Returns an error string or null.
 */
export function panStatusConsistencyError(
  registrations: Array<{ gstin: string; registrationType: 'regular' | 'composition' }>
): string | null {
  const kinds = new Set(registrations.map((r) => r.registrationType));
  if (kinds.size > 1) {
    return 'One PAN cannot hold both a regular and a Composition Scheme GSTIN. Make the registration types consistent before enabling GST billing.';
  }
  return null;
}

/** Format check for an email address; not deliverability. */
export function isPlausibleEmail(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}
