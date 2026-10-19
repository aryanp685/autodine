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

export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  timezone: string;
  tax_rate_bps: number;
  is_active: boolean;
  created_at: string;
};

export type Category = {
  id: string;
  restaurant_id: string;
  menu_id: string | null;
  name: string;
  sort_order: number;
};

export type Item = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  /** Paise. Always paise. */
  price_paise: number;
  is_veg: boolean;
  is_available: boolean;
  image_url: string | null;
  sort_order: number;
};

export type ItemVariant = {
  id: string;
  item_id: string;
  name: string;
  /** Absolute price in paise, not a delta from the item price. */
  price_paise: number;
  sort_order: number;
};

export type MenuItem = Item & { variants: ItemVariant[] };

export type Menu = {
  id: string;
  restaurant_id: string;
  name: string;
  is_published: boolean;
  sort_order: number;
};

export type DiningTable = {
  id: string;
  restaurant_id: string;
  label: string;
  seats: number;
  is_active: boolean;
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
  is_veg: boolean;
  sort_order: number;
};

export type RestaurantMenu = {
  restaurant: Restaurant;
  menu: Menu;
  categories: Category[];
  items: MenuItem[];
};
