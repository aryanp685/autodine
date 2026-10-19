/**
 * Supabase `Database` type.
 *
 * `supabase gen types typescript` normally generates this from the live
 * database. It cannot run without a connected Supabase project, so this
 * hand-written version tracks the current local migration set.
 *
 * REGENERATE as soon as you can:
 *   npx supabase gen types typescript --project-id <ref> > lib/db/database.ts
 *
 * KNOWN WEAKNESS: `Insert` and `Update` are declared as `Partial<Row>`, which
 * is more permissive than the real generated types. Supabase's generator marks
 * columns with defaults as optional and everything else as required. That
 * means TypeScript will NOT stop you from inserting a row that is missing a
 * required column — the database will. Treat this as row-shape documentation
 * with real select-side typing, not as a compile-time guarantee on writes.
 */

import type {
  Category,
  DiningTable,
  Item,
  ItemVariant,
  Menu,
  Order,
  OrderItem,
  PaymentStatus,
  PrepStatus,
  Restaurant,
} from './types';

type Table<Row, Rel extends unknown[] = []> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  // supabase-js v2.5x+ requires this key, and uses it to type embedded
  // selects like .select('*, item_variants(*)'). Without an entry here the
  // embed resolves to SelectQueryError instead of the related rows.
  Relationships: Rel;
};

export type MemberRole = 'owner' | 'manager' | 'kitchen' | 'cashier';

export type Database = {
  public: {
    Tables: {
      restaurants: Table<Restaurant>;
      profiles: Table<{ id: string; full_name: string | null; phone: string | null; created_at: string }>;
      memberships: Table<{
        id: string;
        restaurant_id: string;
        user_id: string;
        role: MemberRole;
        created_at: string;
      }>;
      menus: Table<Menu>;
      categories: Table<Category>;
      items: Table<
        Item,
        [
          {
            foreignKeyName: 'item_variants_item_id_fkey';
            columns: ['id'];
            isOneToOne: false;
            referencedRelation: 'item_variants';
            referencedColumns: ['item_id'];
          },
          {
            foreignKeyName: 'items_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ]
      >;
      item_variants: Table<ItemVariant>;
      dining_tables: Table<DiningTable>;
      qr_tokens: Table<{
        id: string;
        restaurant_id: string;
        table_id: string;
        token: string;
        expires_at: string;
        rotated_at: string;
      }>;
      orders: Table<
        Order,
        [
          {
            foreignKeyName: 'order_items_order_id_fkey';
            columns: ['id'];
            isOneToOne: false;
            referencedRelation: 'order_items';
            referencedColumns: ['order_id'];
          },
        ]
      >;
      order_items: Table<OrderItem>;
      payments: Table<{
        id: string;
        order_id: string;
        restaurant_id: string;
        method: 'cash' | 'card' | 'upi' | 'online';
        amount_paise: number;
        status: 'pending' | 'recorded' | 'failed' | 'refunded';
        provider: string | null;
        provider_ref: string | null;
        idempotency_key: string | null;
        recorded_by: string | null;
        created_at: string;
      }>;
      restaurant_subscriptions: Table<{
        restaurant_id: string;
        plan_code: 'starter' | 'professional' | 'business';
        status: 'pending' | 'active' | 'past_due' | 'canceled';
        current_period_end: string | null;
        created_at: string;
        updated_at: string;
      }>;
      payment_audit_events: Table<{
        id: string;
        restaurant_id: string;
        order_id: string;
        payment_id: string;
        actor_id: string;
        event_type: 'cash_collected';
        method: 'cash';
        amount_paise: number;
        created_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      place_order: {
        Args: {
          p_restaurant_slug: string;
          p_table_token: string;
          p_items: unknown; // jsonb: [{item_id, qty, variant_id?, addons?}]
          p_note?: string | null;
        };
        Returns: string; // new order id (uuid)
      };
      place_counter_order: {
        Args: {
          p_restaurant_slug: string;
          p_items: unknown; // jsonb: [{item_id, qty, variant_id?, addons?}]
          p_note?: string | null;
        };
        Returns: string; // new unpaid counter order id (uuid)
      };
      record_cash_payment: {
        Args: {
          p_restaurant_slug: string;
          p_order_id: string;
          p_amount_paise: number;
          p_idempotency_key: string;
        };
        Returns: string; // payment id (uuid); retries with the same key are idempotent
      };
      restaurant_can_write: {
        Args: { p_restaurant_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      member_role: MemberRole;
      prep_status: PrepStatus;
      payment_status: PaymentStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
