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
      table_qr_codes: Table<{
        id: string;
        restaurant_id: string;
        table_id: string;
        public_token: string;
        source_qr_token_id: string | null;
        created_at: string;
        created_by: string | null;
        revoked_at: string | null;
      }>;
      restaurant_verification_settings: Table<{
        restaurant_id: string;
        code_version: number;
        cashier_access_enabled: boolean;
        updated_at: string;
        updated_by: string | null;
      }>;
      table_verification_sessions: Table<{
        token_hash: string;
        restaurant_id: string;
        table_id: string;
        qr_code_id: string;
        created_at: string;
        expires_at: string;
        revoked_at: string | null;
      }>;
      qr_verification_attempts: Table<{
        qr_code_id: string;
        ip_hash: string;
        attempt_count: number;
        window_started_at: string;
        blocked_until: string | null;
        updated_at: string;
      }>;
      qr_token_migration_issues: Table<{
        legacy_qr_token_id: string;
        reason: 'expired' | 'inactive_table' | 'inactive_restaurant' | 'invalid_token_format' | 'duplicate_token';
        recorded_at: string;
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
          p_session_token: string;
          p_items: unknown; // jsonb: [{item_id, qty, variant_id?, addons?}]
          p_note?: string | null;
        };
        Returns: string; // new order id (uuid); callable only by the trusted server role
      };
      place_order_idempotent: {
        Args: {
          p_session_token: string;
          p_items: unknown;
          p_note: string | null;
          p_request_id: string;
        };
        Returns: string; // new order id or the existing order id on a retry
      };
      reserve_qr_verification_attempt: {
        Args: { p_qr_code_id: string; p_ip_hash: string };
        Returns: { allowed: boolean; retry_after_seconds: number }[];
      };
      record_qr_verification_failure: {
        Args: { p_qr_code_id: string; p_ip_hash: string };
        Returns: boolean;
      };
      clear_qr_verification_attempts: {
        Args: { p_qr_code_id: string; p_ip_hash: string };
        Returns: undefined;
      };
      rotate_restaurant_verification_code: {
        Args: { p_restaurant_id: string; p_actor_id: string };
        Returns: number;
      };
      issue_table_qr_code: {
        Args: { p_restaurant_id: string; p_table_id: string; p_public_token: string; p_actor_id: string };
        Returns: Database['public']['Tables']['table_qr_codes']['Row'];
      };
      revoke_table_qr_code: {
        Args: { p_restaurant_id: string; p_qr_code_id: string };
        Returns: boolean;
      };
      cleanup_expired_qr_verification_attempts: {
        Args: Record<string, never>;
        Returns: number;
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
      set_restaurant_tax_rate: {
        Args: { p_restaurant_id: string; p_tax_rate_bps: number };
        Returns: number;
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
