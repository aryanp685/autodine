/**
 * Load the Settings screen: the restaurant's own details, its tax rate, and
 * the QR that opens its public menu.
 *
 * The restaurant comes from the caller's membership row, never from a slug or
 * a query string — see lib/db/staff.ts. Settings is the one screen where a
 * wrong restaurant would be edited rather than merely displayed, so this is
 * the last place to take an id from the browser.
 *
 * Returns null when Supabase is not configured, and the screen then renders
 * itself disabled with an honest note. It does NOT fall back to sample values:
 * a form pre-filled with a fictional restaurant's name, tax rate and address
 * is a form that can be saved over a real one.
 *
 * A configured-but-blocked caller gets `blocked` and must be shown a prompt,
 * never the form — same contract as lib/db/tables-screen.ts.
 */

import type { OutletOption } from '../outlets';
import { getStaffContextDetailed } from './staff';
import { canEditSettings } from '../settings-input';
import { qrSvg, siteOrigin } from '../qr';
import { publicMenuPath } from '../settings-input';

export type SettingsRestaurant = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  gstin: string;
  slug: string;
};

export type SettingsScreenData = {
  role: string;
  /** Owner or manager. Decided here so the screen can disable what RLS would refuse. */
  canEdit: boolean;
  details: SettingsRestaurant;
  taxRateBps: number;
  /** Has the owner switched card/UPI payment on? */
  onlinePaymentsEnabled: boolean;
  /**
   * Migration 20261028000900. How a guest proves they are at a table.
   *
   * 'code' is the default and the only mode that requires an on-site secret.
   * The other two remove it, which is a decision the owner makes with the
   * trade-off written on the screen -- not something a deployment decides.
   */
  guestVerificationMode: 'code' | 'scan_confirm' | 'scan';
  /** Migration 20261026001300. The restaurant's own handle, or ''. */
  upiId: string;
  /**
   * The name a guest's UPI app shows. Empty means the restaurant's own name is
   * used at render time -- never a platform name.
   */
  upiPayeeName: string;
  /** Read-only: it decides what "today" means in Reports. See the screen. */
  timezone: string;
  /** Absolute when a request origin is known, otherwise the path. */
  publicMenuUrl: string;
  /** A real, scannable code for publicMenuUrl, or null if it could not be drawn. */
  publicMenuSvg: string | null;
  /**
   * How many of this restaurant's menus a guest can actually see. Zero means
   * the QR on this screen opens an empty page, which the screen has to say
   * out loud — a printed standee pointing at nothing is worse than no standee.
   */
  publishedMenus: number;
  totalMenus: number;
  /** Every outlet on this account, so Settings can list and add them. */
  outlets: OutletOption[];
  activeOutletId: string;
  blocked?: 'signed-out' | 'no-membership';
};

export async function getSettingsScreenData(): Promise<SettingsScreenData | null> {
  const staff = await getStaffContextDetailed();

  if (!staff.ok) {
    if (staff.reason === 'unconfigured') return null;
    return {
      role: '',
      canEdit: false,
      details: { name: '', tagline: '', address: '', phone: '', gstin: '', slug: '' },
      taxRateBps: 0,
      onlinePaymentsEnabled: false,
      guestVerificationMode: 'code' as const,
      upiId: '',
      upiPayeeName: '',
      timezone: 'Asia/Kolkata',
      publicMenuUrl: '',
      publicMenuSvg: null,
      publishedMenus: 0,
      totalMenus: 0,
      outlets: [],
      activeOutletId: '',
      blocked: staff.reason,
    };
  }

  const { supabase, restaurantId, role, outlets } = staff.context;

  /**
   * guest_verification_mode exists only after migration 20261028000900, and a
   * select naming a column the database does not have fails as a whole (42703).
   * Settings is a screen an owner opens every day; it must not be taken down by
   * a deployment that shipped ahead of its migration. So the column is asked
   * for, and a missing-column answer retries without it -- with the mode
   * defaulting to 'code', which is what an unmigrated database enforces anyway.
   */
  const restaurantColumns =
    'name, tagline, address, phone, gstin, slug, timezone, tax_rate_bps, online_payments_enabled, upi_id, upi_payee_name, guest_verification_mode';
  const restaurantColumnsLegacy =
    'name, tagline, address, phone, gstin, slug, timezone, tax_rate_bps, online_payments_enabled, upi_id, upi_payee_name';

  const firstRestaurantResult = await supabase
    .from('restaurants')
    .select(restaurantColumns)
    .eq('id', restaurantId)
    .maybeSingle();

  const restaurantResult =
    firstRestaurantResult.error?.code === '42703'
      ? await supabase
          .from('restaurants')
          .select(restaurantColumnsLegacy)
          .eq('id', restaurantId)
          .maybeSingle()
      : firstRestaurantResult;

  const [menusResult] = await Promise.all([
    supabase.from('menus').select('id, is_published').eq('restaurant_id', restaurantId),
  ]);

  if (restaurantResult.error) {
    throw new Error(`Could not load settings: ${restaurantResult.error.message}`);
  }
  if (menusResult.error) {
    throw new Error(`Could not load menus: ${menusResult.error.message}`);
  }

  const row = restaurantResult.data;
  if (!row) {
    // The membership points at a restaurant the caller cannot read. That is a
    // data problem, not a settings screen, and it must not render a form.
    return {
      role,
      canEdit: false,
      details: { name: '', tagline: '', address: '', phone: '', gstin: '', slug: '' },
      taxRateBps: 0,
      onlinePaymentsEnabled: false,
      guestVerificationMode: 'code' as const,
      upiId: '',
      upiPayeeName: '',
      timezone: 'Asia/Kolkata',
      publicMenuUrl: '',
      publicMenuSvg: null,
      publishedMenus: 0,
      totalMenus: 0,
      outlets: [],
      activeOutletId: '',
      blocked: 'no-membership',
    };
  }

  const slug = String(row.slug ?? '');
  const origin = await siteOrigin();
  const path = publicMenuPath(slug);
  const publicMenuUrl = `${origin.replace(/\/+$/, '')}${path}`;
  const publicMenuSvg = slug ? await qrSvg(publicMenuUrl) : null;

  const menus = menusResult.data ?? [];

  return {
    role,
    canEdit: canEditSettings(role),
    details: {
      name: String(row.name ?? ''),
      tagline: String(row.tagline ?? ''),
      address: String(row.address ?? ''),
      phone: String(row.phone ?? ''),
      gstin: String(row.gstin ?? ''),
      slug,
    },
    // A database with no rate at all is read as 0, not as the sample 5% in
    // lib/pricing.ts. The sample is a layout number; charging it would be
    // inventing a tax nobody set.
    taxRateBps: Number(row.tax_rate_bps ?? 0),
    onlinePaymentsEnabled: row.online_payments_enabled === true,
    // Read through a cast because the same query has a legacy shape without
    // this column; see the retry above. Absent means 'code'.
    guestVerificationMode: (() => {
      const mode = (row as { guest_verification_mode?: string | null }).guest_verification_mode;
      return mode === 'scan_confirm' || mode === 'scan' ? mode : 'code';
    })(),
    upiId: String((row as { upi_id?: string | null }).upi_id ?? ''),
    upiPayeeName: String((row as { upi_payee_name?: string | null }).upi_payee_name ?? ''),
    timezone: String(row.timezone ?? 'Asia/Kolkata'),
    publicMenuUrl,
    publicMenuSvg,
    publishedMenus: menus.filter((menu) => menu.is_published === true).length,
    totalMenus: menus.length,
    outlets,
    activeOutletId: restaurantId,
  };
}
