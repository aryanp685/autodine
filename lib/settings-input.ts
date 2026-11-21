/**
 * What the Settings screen is allowed to save.
 *
 * Kept out of the database module and the Server Action because it is the one
 * part of Settings that is pure: given the text a browser posted, it decides
 * whether that text is a restaurant name, a GSTIN, a tax rate or a slug, and
 * it says exactly which field is wrong when it is not. That means it can be
 * tested without a database, and the same rules run on every write path.
 *
 * WHY VALIDATE AT ALL, WHEN THE DATABASE HAS TYPES
 *
 * The database types stop a name being a number. They do not stop a name being
 * 4,000 characters, a tax rate of 18 entered as 1800 bps, or a GSTIN with the
 * wrong digit count. Each of those is a real way a bill comes out wrong, and a
 * wrong bill is money the guest cannot check and finance finds a quarter later.
 *
 * WHERE THE LIMITS COME FROM
 *
 *   tax_rate_bps   the column's own CHECK: 0 .. 3000 (0% .. 30%).
 *   slug           a URL segment, so lowercase ASCII, digits and hyphens.
 *   gstin          the 15-character GSTIN format, including the trailing
 *                  checksum digit's alphabet. Not checksum-verified: the
 *                  check digit algorithm is public but a typo caught here is
 *                  better than a valid-looking GSTIN that belongs to nobody.
 */

import { applyRate, rupeesToPaise } from './money';
import { slugify } from './slug';

/** Roles that may change these fields. Mirrors the RLS policy in migration 00500. */
export const SETTINGS_WRITE_ROLES = ['owner', 'manager'] as const;

export function canEditSettings(role: string | null | undefined): boolean {
  return (SETTINGS_WRITE_ROLES as readonly string[]).includes(role ?? '');
}

/** The column's CHECK constraint. 3000 bps = 30%. */
export const MAX_TAX_BPS = 3000;

export const MAX_NAME_LENGTH = 80;
export const MAX_TAGLINE_LENGTH = 120;
export const MAX_ADDRESS_LENGTH = 200;
export const MAX_PHONE_LENGTH = 24;

export type SettingsField = 'name' | 'tagline' | 'address' | 'phone' | 'gstin' | 'slug' | 'taxRate';

export type DetailsValue = {
  name: string;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  slug: string;
};

export type DetailsResult =
  | { ok: true; value: DetailsValue }
  | { ok: false; field: SettingsField; message: string };

/** Trim, collapse whitespace, and treat blank as absent. */
function clean(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

/**
 * A GSTIN, in the format the GST portal issues.
 *
 * 2 digits of state code, 5 letters of PAN, 4 digits, 1 letter, 1 alphanumeric
 * entity code, a literal Z, and a check digit. The Z is worth enforcing: a
 * PAN pasted in its place produces a number that looks like a GSTIN on an
 * invoice and cannot be filed.
 */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * A phone number a delivery rider could actually dial.
 *
 * Deliberately loose about punctuation and country codes: Indian numbers are
 * written "+91 98765 43210", "098765-43210" and "9876543210" by different
 * people, and refusing two of those three would be a bug. What is enforced is
 * the digit count, which is what makes the number useless when wrong.
 */
function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function validateDetails(raw: {
  name?: unknown;
  tagline?: unknown;
  address?: unknown;
  phone?: unknown;
  gstin?: unknown;
  slug?: unknown;
}): DetailsResult {
  const name = clean(raw.name);
  if (!name) return { ok: false, field: 'name', message: 'The restaurant needs a name.' };
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      field: 'name',
      message: `Keep the name under ${MAX_NAME_LENGTH} characters — it is printed on the bill.`,
    };
  }

  const tagline = clean(raw.tagline);
  if (tagline.length > MAX_TAGLINE_LENGTH) {
    return {
      ok: false,
      field: 'tagline',
      message: `Keep the tagline under ${MAX_TAGLINE_LENGTH} characters.`,
    };
  }

  const address = clean(raw.address);
  if (address.length > MAX_ADDRESS_LENGTH) {
    return {
      ok: false,
      field: 'address',
      message: `Keep the address under ${MAX_ADDRESS_LENGTH} characters.`,
    };
  }

  const phone = clean(raw.phone);
  if (phone) {
    const digits = phoneDigits(phone);
    // 10 digits for a local Indian number; 12 with the 91 country code. Short
    // of that it is a landline with an STD code, which is still a real thing.
    if (digits.length < 10 || digits.length > 15 || phone.length > MAX_PHONE_LENGTH) {
      return {
        ok: false,
        field: 'phone',
        message: 'That phone number does not look complete — give the number a guest should call.',
      };
    }
  }

  const gstin = clean(raw.gstin).toUpperCase();
  if (gstin && !GSTIN_PATTERN.test(gstin)) {
    return {
      ok: false,
      field: 'gstin',
      message: 'A GSTIN is 15 characters, like 22AAAAA0000A1Z5. Leave it blank if you are not registered.',
    };
  }

  // The slug is normalised rather than rejected: an owner typing "My Cafe!"
  // means my-cafe, and refusing that would be a puzzle rather than a rule.
  const slug = slugify(clean(raw.slug));
  if (!slug) {
    return {
      ok: false,
      field: 'slug',
      message: 'The web address needs at least one letter or number.',
    };
  }
  if (slug.length < 2) {
    return {
      ok: false,
      field: 'slug',
      message: 'The web address needs at least two characters.',
    };
  }

  return {
    ok: true,
    value: {
      name,
      tagline: tagline || null,
      address: address || null,
      phone: phone || null,
      gstin: gstin || null,
      slug,
    },
  };
}

export type TaxResult = { ok: true; bps: number } | { ok: false; message: string };

/**
 * Read a tax rate the way an owner types it: "18", "18.5", "5%", "0".
 *
 * Stored as basis points, so "18.5" is 1850. Rejecting more than two decimal
 * places rather than rounding them away: "18.505" is a rate the owner did not
 * mean, and silently charging 18.51% would be a number they never saw.
 */
export function parseTaxPercent(raw: unknown): TaxResult {
  const text = typeof raw === 'string' ? raw.trim().replace(/%/g, '').trim() : '';
  if (!text) return { ok: false, message: 'Enter the tax rate as a percentage, for example 5 or 18.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, message: 'Use a percentage with up to two decimals, for example 5 or 18.5.' };
  }

  const bps = Math.round(Number(text) * 100);
  if (!Number.isFinite(bps) || bps < 0 || bps > MAX_TAX_BPS) {
    return {
      ok: false,
      message: `The rate must be between 0% and ${MAX_TAX_BPS / 100}%.`,
    };
  }

  return { ok: true, bps };
}

/** 1850 -> "18.5", 500 -> "5". No trailing zeros: the field is for typing in. */
export function formatTaxPercent(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0$/, '');
}

/**
 * What a ₹100 dish actually bills at this rate — the number that makes a
 * percentage mean something to the person setting it.
 *
 * Uses lib/money so the example rounds exactly the way the order does; an
 * example that disagrees with the bill by a paisa is the kind of thing that
 * makes an owner distrust the whole screen.
 */
export function taxExamplePaise(bps: number): { basePaise: number; taxPaise: number; totalPaise: number } {
  const basePaise = rupeesToPaise(100);
  const taxPaise = applyRate(basePaise, bps);
  return { basePaise, taxPaise, totalPaise: basePaise + taxPaise };
}

/** The public menu a QR code and a shared link point at. */
export function publicMenuPath(slug: string): string {
  return `/menu?s=${encodeURIComponent(slug)}`;
}


/**
 * A UPI handle, validated the way the database validates it.
 *
 * The same pattern as the restaurants_upi_id_check constraint in migration
 * 20261026001300, on purpose: a form that accepts `thegulmohar` and gets a
 * Postgres error back is a form that wasted the owner's time. Deliberately
 * loose — one `@`, a plausible local part, a 2+ letter handle — because real
 * handles contain dots, digits and hyphens, and a stricter rule would reject
 * them.
 *
 * An empty string is a VALID answer: it means "no UPI QR", and it clears the
 * column. It is not the same as malformed.
 */
export type UpiResult =
  | { ok: true; value: { upiId: string | null; payeeName: string | null } }
  | { ok: false; message: string };

const UPI_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}$/;

export function validateUpi(raw: { upiId: unknown; payeeName: unknown }): UpiResult {
  const upiId = String(raw.upiId ?? '').trim();
  const payeeName = String(raw.payeeName ?? '').trim();

  if (upiId === '') {
    return { ok: true, value: { upiId: null, payeeName: null } };
  }

  if (upiId.length > 300) {
    return { ok: false, message: 'That UPI ID is too long. It should look like name@bank.' };
  }

  if (!UPI_PATTERN.test(upiId)) {
    return {
      ok: false,
      message: 'That does not look like a UPI ID. It should look like name@bank — for example thegulmohar@okhdfcbank.',
    };
  }

  if (payeeName.length > 80) {
    return { ok: false, message: 'Keep the payee name under 80 characters — it has to fit in a UPI app.' };
  }

  return {
    ok: true,
    value: { upiId, payeeName: payeeName === '' ? null : payeeName },
  };
}
