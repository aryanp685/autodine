export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
/**
 * Row shapes for supabase/migrations/20261019000001_init.sql.
 *
 * Hand-written because the Supabase CLI, which normally generates these,
 * cannot run here (no network to Supabase, no local Postgres). They are kept
 * next to the migration and must be updated whenever it changes.
 *
 * The Supabase CLI can regenerate and replace this file once you can run it:
 *   npx supabase gen types typescript --local > lib/db/types.ts
 */

import type { TranslationMap } from '@/lib/i18n/translations';

export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  /** Migration 20261121000100 (Billing Spec v2.0). */
  fssai_number?: string | null;
  bill_footer_note?: string | null;
  default_service_charge_bps?: number;
  default_packaging_charge_paise?: number;
  default_delivery_charge_paise?: number;
  round_off_enabled?: boolean;
  timezone: string;
  tax_rate_bps: number;
  is_active: boolean;
  /** Migration 20261107000000. The announcement banner: one line, off by default. */
  announcement_text: string | null;
  announcement_on: boolean;
  /**
   * Migration 20261025001000. Storage object paths, not URLs -- see
   * lib/storage/assets.ts for why. Null means "never uploaded", which is the
   * normal case and is drawn as a designed state, never as a broken image.
   */
  logo_path: string | null;
  banner_path: string | null;
  /** Key into the curated palette in lib/branding/palette.ts. */
  accent: string;
  /**
   * Migration 20261103000100 (brand studio). Opt-in per-restaurant guest
   * theming. False for every restaurant that has never published a brand
   * profile — the existing appearance is the default. `brand_theme` is the
   * validated theme JSON written only by publish_menu_brand_pair, and
   * `brand_profile_id` points at the approved profile row.
   */
  brand_theme_enabled?: boolean;
  brand_theme?: unknown | null;
  brand_profile_id?: string | null;
  /**
   * Migration 20261028000900. How a guest proves they are at a table:
   * 'code' (rotating digits, the default), 'scan_confirm' (scan, then one
   * staff tap per sitting) or 'scan'. The last two cannot prove presence and
   * must never be described as if they do.
   */
  guest_verification_mode?: 'code' | 'scan_confirm' | 'scan';
  updated_at: string;
  created_at: string;
  /**
   * Legacy plan/trial fields retained in the database for compatibility.
   * `trial_started_at` is written once and never moved. Migration
   * 20261114000100 removes direct SELECT for API roles; Owner/Manager billing
   * presentation comes from `public.restaurant_access()` instead.
   */
  trial_started_at?: string;
  plan?: 'trial' | 'starter' | 'professional' | 'business';
  plan_status?: 'trialing' | 'active' | 'expired' | 'cancelled';
  plan_started_at?: string | null;
  plan_expires_at?: string | null;
  /**
   * Migration 20261026001300. The restaurant's OWN UPI handle, shown to its
   * guests as a QR. Null means no QR is drawn -- never a placeholder payee.
   */
  upi_id?: string | null;
  upi_payee_name?: string | null;
};

export type Category = {
  id: string;
  restaurant_id: string;
  menu_id: string | null;
  name: string;
  sort_order: number;
  /** Saved translations. Optional: not selected everywhere a category is read. */
  translations?: TranslationMap;
};

export type Item = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  /** Paise. Always paise. */
  price_paise: number;
  is_veg: boolean | null;
  is_available: boolean;
  image_url: string | null;
  sort_order: number;
  /**
   * How the kitchen board should SAY this dish, when the automatic
   * transliteration is wrong. Null means "say the name" -- see lib/hindi.ts.
   *
   * Optional because it is not selected everywhere an item is read, and a
   * customer-facing menu has no use for it.
   */
  spoken_name?: string | null;
  /** Saved translations. Optional: not selected everywhere an item is read. */
  translations?: TranslationMap;
  /** Optional: only selected where the GST screens read it. */
  is_alcoholic?: boolean;
};

export type ItemVariant = {
  id: string;
  item_id: string;
  name: string;
  /** Absolute price in paise, not a delta from the item price. */
  price_paise: number;
  sort_order: number;
};

/**
 * A heading of choices against one dish -- "Add a little extra", "Jain /
 * no onion". Defined per dish, never shared between dishes.
 */
export type ItemAddonGroup = {
  id: string;
  item_id: string;
  name: string;
  /** 0 = the guest may skip it. >= 1 = shown as required, default chosen. */
  min_select: number;
  /** 1 = pick one. Higher = pick up to that many. */
  max_select: number;
  sort_order: number;
};

/** One choice inside a group, with the price it adds to a plate. */
export type ItemAddon = {
  id: string;
  group_id: string;
  name: string;
  /** Paise. 0 is a real price: "Jain" costs nothing and still matters. */
  price_paise: number;
  is_available: boolean;
  sort_order: number;
};

export type MenuItem = Item & {
  variants: ItemVariant[];
  /** Add-on groups with their options already attached. */
  addonGroups?: (ItemAddonGroup & { addons: ItemAddon[] })[];
};

export type Menu = {
  id: string;
  restaurant_id: string;
  name: string;
  is_published: boolean;
  sort_order: number;
  /**
   * Migration 20261103000100. The stable import identifier linking this menu
   * draft to its brand draft. Null for menus created by hand.
   */
  import_id?: string | null;
};

export type DiningTable = {
  id: string;
  restaurant_id: string;
  label: string;
  seats: number;
  is_active: boolean;
};

export type OrderChannel = 'dine_in' | 'takeaway' | 'delivery';

/** One guest sitting; independent of the short-lived QR verification session. */
export type OrderSession = {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  order_channel?: OrderChannel;
  customer_name?: string | null;
  customer_phone?: string | null;
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  paid_at?: string | null;
  paid_by?: string | null;
  status: 'open' | 'closed';
};

export type RestaurantInvoiceReprint = {
  id: string;
  restaurant_id: string;
  invoice_id: string;
  copy_number: number;
  format: '58mm' | '80mm' | 'a4' | 'pdf' | 'escpos';
  reprinted_by: string | null;
  reprinted_at: string;
};

export type RestaurantInvoice = {
  id: string;
  restaurant_id: string;
  order_session_id: string;
  invoice_number: string;
  financial_year: string;
  sequence_number: number;
  /** Migration 20261113000100 adds 'bill_of_supply'. */
  document_type: 'receipt' | 'gst_tax_invoice' | 'bill_of_supply';
  /** e-Invoice state; 'not_required' in this build (no IRP provider). */
  irp_status: 'not_required' | 'pending' | 'generated' | 'failed' | 'cancelled';
  /** IRN assigned only after the IRP validates. NULL in this build. */
  irn: string | null;
  /** Immutable GST decomposition; NULL for non-GST receipts. */
  gst_snapshot: unknown | null;
  status: 'issued' | 'voided';
  issued_at: string;
  issued_by: string | null;
  table_label_snapshot: string | null;
  session_opened_at: string;
  session_closed_at: string;
  seller_snapshot: unknown;
  customer_snapshot: unknown | null;
  totals_snapshot: unknown;
  payment_snapshot: unknown;
  source_order_ids: string[];
  supersedes_invoice_id: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
};

/**
 * Migration 20261114000500. Immutable credit/debit note against one GST
 * document; written only by the definer RPCs. IDs are stable; amounts are
 * integer paise copied from the parent's immutable snapshots.
 */
export type RestaurantNote = {
  id: string;
  restaurant_id: string;
  invoice_id: string;
  document_type: 'credit_note' | 'debit_note';
  document_number: string;
  financial_year: string;
  sequence_number: number;
  status: 'issued' | 'voided';
  reason_code: 'returned_supply' | 'quantity_difference' | 'rate_difference' | 'post_supply_change' | 'other';
  reason: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  gst_snapshot: unknown;
  seller_snapshot: unknown;
  customer_snapshot: unknown | null;
  totals_snapshot: unknown;
  payment_snapshot: unknown;
  irp_status: 'not_required' | 'pending' | 'generated' | 'failed' | 'cancelled';
  irn: string | null;
  source_document_number: string;
  source_issued_at: string;
  issued_at: string;
  issued_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
};

/** Append-only audit ledger for note issuance and voids. */
export type RestaurantNoteEvent = {
  id: string;
  note_id: string;
  restaurant_id: string;
  event: 'issued' | 'voided';
  reason: string;
  actor: string | null;
  created_at: string;
};

/**
 * Migration 20261113000100. One live row per restaurant; mode 'off' is the
 * default and means the historical non-GST receipt behaviour.
 */
export type RestaurantGstConfig = {
  restaurant_id: string;
  mode: 'off' | 'regular' | 'composition';
  regular_profile: 'other_than_specified_premises' | 'specified_premises' | null;
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  address: string | null;
  state_code: string | null;
  pan: string | null;
  registration_type: 'regular' | 'composition';
  composition_acknowledged: boolean;
  specified_premises_attested: boolean;
  specified_premises_effective_from: string;
  off_declared: boolean;
  off_declared_at: string | null;
  preceding_fy_turnover_paise: number | null;
  config_version: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

export type RestaurantInvoiceLine = {
  id: string;
  invoice_id: string;
  restaurant_id: string;
  line_number: number;
  source_order_id: string;
  source_order_item_id: string | null;
  line_snapshot: unknown;
  created_at: string;
};

export type RestaurantPaymentReceipt = {
  id: string;
  restaurant_id: string;
  invoice_id: string;
  payment_id: string;
  sequence_number: number;
  receipt_reference: string;
  issued_at: string;
  snapshot: unknown;
  created_at: string;
};

export type PrepStatus = 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type Order = {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  code: string;
  customer_note: string | null;
  prep_status: PrepStatus;
  payment_status: PaymentStatus;
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  placed_at: string;
  updated_at: string;
  /**
   * The guest's own key to this order (migration 00600). Null on counter
   * orders and on anything placed before the column existed -- which is why
   * every guest-side function treats null as "not yours to open".
   */
  guest_token: string | null;
  /** 'guest' or 'staff', or a staff member's own words. */
  cancel_reason: string | null;
  /**
   * The tax rate this order was priced at, frozen at the moment it was
   * placed. A bill must show the rate it was charged, not today's.
   */
  tax_rate_bps_snapshot: number | null;
  /**
   * Migration 20261028000900. True when the order arrived under a scan-mode
   * restaurant and no human had vouched for the table yet. Written once, at
   * insert, and never recomputed -- a setting changed at 20:05 must not
   * release a ticket that was held at 20:04.
   */
  hold_required?: boolean;
  /** When staff accepted a held table. Null means nobody has. */
  confirmed_at?: string | null;
  /** Who tapped confirm. Null for anything not confirmed by a person. */
  confirmed_by?: string | null;
  /** Short-lived QR verification session (not the bill/sitting session). */
  table_session_id?: string | null;
  /** Durable table sitting used to group incremental tickets into one bill. */
  order_session_id?: string | null;
  /** Last persistent kitchen announcement outcome, written by a guarded RPC. */
  kitchen_announcement_status?: 'announced' | 'failed' | null;
  kitchen_announcement_at?: string | null;
  kitchen_announcement_error?: string | null;
  /** Migration 20261121000100 (Billing Spec v2.0). */
  order_channel?: OrderChannel;
  discount_reason?: string | null;
  is_complimentary?: boolean;
  complimentary_reason?: string | null;
  service_charge_paise?: number;
  packaging_charge_paise?: number;
  delivery_charge_paise?: number;
  round_off_paise?: number;
};

/** A guest's open request for a staff member to visit their table. */
export type TableWaiterCall = {
  id: string;
  restaurant_id: string;
  table_id: string;
  table_session_hash: string | null;
  table_label_snapshot: string;
  request_key: string;
  status: 'open' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  announcement_status: 'pending' | 'claimed' | 'announced' | 'failed';
  announcement_claimed_at: string | null;
  announcement_at: string | null;
  announcement_error: string | null;
};

export type OrderItem = {
  id: string;
  order_id: string;
  item_id: string | null;
  name_snapshot: string;
  unit_price_paise: number;
  qty: number;
  variant_snapshot: string | null;
  addons_snapshot: string[];
  is_veg: boolean | null;
  sort_order: number;
};

/**
 * A menu a guest may switch to: just enough to draw the tab.
 *
 * The rest of a menu is loaded only when it is the one being shown. A venue
 * with three menus must not pay for three menus' worth of dishes to look at
 * one of them.
 */
export type MenuOption = { id: string; name: string };

export type RestaurantMenu = {
  restaurant: Restaurant;
  /** The menu being shown. */
  menu: Menu;
  /** Every published menu, in the restaurant's own order. Never empty. */
  menus: MenuOption[];
  categories: Category[];
  items: MenuItem[];
};
