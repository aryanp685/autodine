import { checkGstin, GST_STATE_CODES, isPlausibleEmail } from './gstin';

export type BuyerFields = {
  name: string; gstin: string; address: string; location: string; pincode: string;
  state_code?: string; email?: string; phone?: string;
};
export type SavedGstBuyer = { id: string; revision: number; details: BuyerFields };
export const GST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type CheckoutRecipient = Partial<BuyerFields> & {
  recipient_type?: 'registered' | 'consumer';
  buyer_id?: string; revision?: number;
};

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

/** Scope and actual government registration are checked separately. */
export function normalizeCheckoutRecipient(raw: CheckoutRecipient, requireStructuredAddress = false):
  { ok: true; data: CheckoutRecipient } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const allowed = ['buyer_id','revision','recipient_type','name','gstin','address','state_code','location','pincode','email','phone'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((k) => !allowed.includes(k))) {
    return fail('Use the supported direct restaurant buyer fields only.');
  }
  if (raw.buyer_id) {
    if (!GST_UUID.test(raw.buyer_id) || typeof raw.revision !== 'number' || !Number.isInteger(raw.revision)
      || raw.revision < 1 || raw.revision >= 1_000_000_000 || Object.keys(raw).some((k) => k !== 'buyer_id' && k !== 'revision')) {
      return fail('Select the current saved buyer for this outlet.');
    }
    return { ok: true, data: { buyer_id: raw.buyer_id, revision: raw.revision } };
  }
  const name = text(raw.name), gstin = text(raw.gstin).toUpperCase(), address = text(raw.address);
  const state = text(raw.state_code);
  if (name.length < 2 || name.length > 160) return fail('Enter the buyer legal name (2–160 characters).');
  if (raw.recipient_type === 'consumer') {
    if (gstin || address.length < 5 || address.length > 300 || !GST_STATE_CODES.has(state) || ['25','28'].includes(state)) {
      return fail('Enter unregistered buyer name, billing address and state without a GSTIN.');
    }
    return { ok: true, data: { recipient_type: 'consumer', name, address, state_code: state } };
  }
  if (raw.recipient_type && raw.recipient_type !== 'registered') return fail('This recipient type is not supported.');
  const check = checkGstin(gstin);
  if (!check.ok) return fail(`The buyer GSTIN is not usable: ${check.reason}`);
  if (state && state !== check.parts.stateCode) return fail('Buyer state must match its GSTIN.');
  if (address.length < 5 || address.length > 300) return fail('Enter the buyer billing address (5–300 characters).');
  const location = text(raw.location), pincode = text(raw.pincode);
  if ((requireStructuredAddress || location || pincode) && (location.length < 2 || location.length > 50 || !/^[1-9][0-9]{5}$/.test(pincode))) {
    return fail('Enter the buyer billing city and six-digit PIN.');
  }
  const email = text(raw.email).toLowerCase(), phone = text(raw.phone);
  if (email && (!isPlausibleEmail(email) || email.length > 100)) return fail('The buyer email address does not look usable.');
  if (phone && !/^[+0-9][0-9 ()+.-]{5,23}$/.test(phone)) return fail('Enter a usable buyer phone number or leave it blank.');
  return { ok: true, data: { name, gstin, address, ...(state ? { state_code: state } : {}),
    ...(location ? { location, pincode } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) } };
}
