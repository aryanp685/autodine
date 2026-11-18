/**
 * Tax-address parsing for e-Invoice (IRP) payloads.
 *
 * The invoice snapshot stores the buyer's address as ONE free-text block
 * exactly as the cashier captured it. NIC requires the buyer's address line,
 * city/district/taluka (Location) and a 6-digit PIN separately, so the block
 * is decomposed deterministically:
 *
 *   - pincode := the LAST 6-digit run whose first digit is 1-9 (conventionally
 *                the trailing PIN of an Indian postal address);
 *   - location := the final comma-separated segment before the pincode, with
 *                trailing separators/digits stripped; must contain letters.
 *                The split never guesses inside a segment: for un-commaed
 *                addresses the last segment keeps its street words — record
 *                addresses comma-separated ("street, area, city – pincode").
 *   - address1 := the whole trimmed block (NIC address line), unchanged;
 *                longer than 100 characters it is REFUSED, never truncated —
 *                a silently shortened legal address on a tax document is worse
 *                than a refusal.
 *
 * No segment is invented: anything that cannot be found fails closed with a
 * machine-readable reason the owner can act on.
 */

export type TaxAddress = {
  address1: string;
  location: string;
  pincode: string;
};

export type TaxAddressResult = { ok: true; address: TaxAddress } | { ok: false; reason: string };

const PIN = /[1-9][0-9]{5}/g;
const SEPARATORS = /[\s,\-–—:/]+$/;

export function parseTaxAddress(raw: string | null | undefined): TaxAddressResult {
  const trimmed = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (trimmed.length < 5) {
    return { ok: false, reason: 'The address is missing or too short to be usable.' };
  }
  if (trimmed.length > 100) {
    return { ok: false, reason: 'The registered address is longer than 100 characters, which the e-Invoice format cannot carry. Shorten it in settings before issuing.' };
  }
  const pins = trimmed.match(PIN);
  if (!pins || pins.length === 0) {
    return { ok: false, reason: 'No 6-digit PIN code found in the address. Record the full postal address including the PIN.' };
  }
  const pincode = pins[pins.length - 1];
  const beforePin = trimmed.slice(0, trimmed.lastIndexOf(pincode)).replace(SEPARATORS, '').trim();
  const segments = beforePin.split(',').map((segment) => segment.trim()).filter(Boolean);
  const location = (segments.length > 0 ? segments[segments.length - 1] : '').trim();
  if (!/[A-Za-z]/.test(location)) {
    return { ok: false, reason: 'Could not find the city/district/taluka before the PIN code. Record the address as "street, area, city – pincode".' };
  }
  if (location.length > 120) {
    return { ok: false, reason: 'The city/district/taluka segment is longer than 120 characters. Shorten it in the address.' };
  }
  return { ok: true, address: { address1: trimmed, location, pincode } };
}
