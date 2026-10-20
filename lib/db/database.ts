/**
 * Supabase `Database` type.
 *
 * `supabase gen types typescript` normally generates this from the live
 * database. It cannot run here (no network to Supabase, no local Postgres),
 * so it is hand-written to match supabase/migrations/20261019000001_init.sql.
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
        created_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      /**
       * Signature verified against the live database on 2026-10-20. It takes
       * a table-verification SESSION token, not a restaurant slug and a table
       * token as this file previously claimed -- the QR flow was reworked into
       * table_verification_sessions after migration 0001 was written.
       */
      place_order: {
        Args: {
          p_session_token: string;
          p_items: unknown; // jsonb: [{item_id, qty, variant_id?, addons?}]
          p_note?: string | null;
        };
        Returns: string; // new order id (uuid)
      };
      /** Counter order that is never tied to a table: takeaway / walk-in. */
      place_counter_order: {
        Args: {
          p_restaurant_slug: string;
          p_items: unknown; // jsonb
          p_note?: string | null;
        };
        Returns: string; // new order id (uuid)
      };
      /**
       * The ONLY way money is taken at the counter. Atomic: inserts the
       * payment, settles the order and writes an audit event in one
       * transaction.
       *
       * Three things it enforces that the application must not duplicate:
       *   - the caller must be owner, manager or cashier
       *   - p_amount_paise must EXACTLY equal the outstanding balance, so
       *     there is no "amount received" and no change to compute
       *   - p_idempotency_key makes a retry return the original payment
       *     instead of charging twice. Generate it ONCE per attempt, on the
       *     client, and reuse it if the call is retried.
       *
       * CASH ONLY. The payments table allows card/upi/online, but this
       * function hardcodes method = 'cash'. See app/cashier/actions.ts.
       */
      record_cash_payment: {
        Args: {
          p_restaurant_slug: string;
          p_order_id: string;
          p_amount_paise: number;
          p_idempotency_key: string;
        };
        Returns: string; // payment id (uuid)
      };
      /**
       * Migration 0004. The one the counter actually uses: same guarantees as
       * record_cash_payment but takes a method, so card and UPI work too.
       *
       *   - caller must be owner, manager or cashier
       *   - p_amount_paise must EXACTLY equal the outstanding balance
       *   - p_idempotency_key makes a retry return the original payment
       *     instead of charging twice. Generate it ONCE per attempt, on the
       *     client, and reuse it if the call is retried.
       *   - p_method is part of the idempotency key, so a cash attempt and a
       *     card attempt cannot be answered with each other's payment.
       *
       * 'online' is rejected here on purpose. An online payment is initiated
       * by the guest through a provider and arrives by webhook with a
       * provider reference; a cashier must not be able to record one.
       */
      record_counter_payment: {
        Args: {
          p_restaurant_slug: string;
          p_order_id: string;
          p_method: 'cash' | 'card' | 'upi';
          p_amount_paise: number;
          p_idempotency_key: string;
        };
        Returns: string; // payment id (uuid)
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
