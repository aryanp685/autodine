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
      /**
       * The printed card's code. This is the scheme scanning uses.
       *
       * qr_tokens, defined below it, is the older twelve-hour rotating
       * scheme. Nothing writes to it any more and nothing reads it. It is
       * still typed because table_qr_codes.source_qr_token_id references it
       * and dropping the type would mean the column could not be described.
       * If you are deciding which of the two to use: this one.
       */
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
      /**
       * Migration 0006. Exchange a scanned table QR token for a session.
       *
       * The token in the URL is printed on the table and is not a secret.
       * What comes back is: 64 hex characters, generated inside the database,
       * handed over once and stored there only as a SHA-256 hash. It expires,
       * and revoking the QR code revokes every session issued against it.
       *
       * Rate limited per code and per IP hash: five attempts in fifteen
       * minutes, then a fifteen minute block. p_ip_hash must be 64 hex
       * characters -- sha256 of the caller's address, salted with the token.
       *
       * Raises P0001 with a guest-readable message for every failure a guest
       * can cause: unreadable code, revoked code, table out of service,
       * restaurant paused, menu not published, rate limited. Those are shown;
       * anything else is logged and replaced.
       */
      verify_table_qr: {
        Args: {
          p_public_token: string;
          p_ip_hash: string;
        };
        Returns: {
          session_token: string;
          restaurant_slug: string;
          table_label: string;
          expires_at: string;
        }[];
      };
      /**
       * Migration 0007. Replace a table's printed code, and take one out of
       * service.
       *
       * Both are SECURITY DEFINER and both check membership against the
       * session before touching anything, which is the only thing that makes
       * them safe to grant: under SECURITY DEFINER, RLS is suspended inside
       * the function body, so a missing check would let any signed-in user
       * rotate -- and read back -- the live code for any table anywhere.
       *
       * Neither is granted to anon. A guest scans codes; only staff issue
       * them.
       *
       * Rotation revokes the old code before inserting the new one, in one
       * transaction. Split across two client writes, a failure between them
       * would leave the table with no live code at all.
       *
       * Both raise 42501 'You do not manage this restaurant.' and P0002
       * 'That table does not exist.' -- staff-facing, unlike the P0001s in
       * verify_table_qr which are written for guests.
       */
      rotate_table_qr_code: {
        Args: { p_table_id: string };
        /** The new public token, so the caller can re-render the card. */
        Returns: string;
      };
      retire_table_qr_code: {
        Args: { p_table_id: string };
        Returns: undefined;
      };
      /**
       * Migration 0009. Sales aggregates for one restaurant and one range.
       *
       * Returns jsonb rather than a row set because the shape is nested:
       * totals, a bucket series, item and category rankings, payment methods
       * and the order ledger all in one round trip. Fetching those separately
       * would be a join the app has to do by hand, chunking order ids into
       * `.in()` lists -- and a long range would silently truncate.
       *
       * SECURITY DEFINER with `is_member()` inside, because RLS is suspended
       * in the body. Granted to authenticated only; anon gets 42501.
       *
       * `p_bucket` is 'hour' or 'day'. `p_include_lines` adds every order line
       * in the range, which is only wanted for the CSV export -- it is a much
       * bigger payload than the screen needs.
       */
      report_sales: {
        Args: {
          p_restaurant_id: string;
          p_from: string;
          p_to: string;
          p_timezone?: string;
          p_bucket?: 'hour' | 'day';
          p_order_limit?: number;
          p_include_lines?: boolean;
        };
        Returns: unknown; // jsonb; parsed by lib/db/reports.ts
      };
      /**
       * Migration 0005. The only way a signed-out diner places an order.
       *
       * The orders and order_items tables have NO insert policy for anon --
       * under RLS a missing policy means denied, and a permissive one would
       * let a guest name their own unit_price_paise or attach lines to
       * somebody else's order. So the write goes through here instead.
       *
       * What makes it safe to expose to anon:
       *   - it takes dish ids and quantities, never prices or totals
       *   - every price is read from items, scoped to this restaurant's
       *     published menu, so a dish from another kitchen cannot be ordered
       *   - tax is restaurants.tax_rate_bps, the same column
       *     place_counter_order reads -- 5% is only the fallback
       *   - order and lines commit in one transaction, so a ticket can never
       *     reach the kitchen pass with nothing on it
       *   - it rejects a restaurant in read-only mode
       *
       * Raises P0001 with a customer-readable message for the failures a
       * customer can cause (no items, sold out, unknown restaurant), so the
       * action passes those through and logs everything else.
       *
       * Returns the human-facing code, e.g. 'MA-K3F9Q'.
       *
       * Migration 0006 adds p_session_token. Pass the token from
       * verify_table_qr and the order is stamped with that table, which is
       * what lets the kitchen board say which table a ticket belongs to.
       * Omit it and the order is a counter order with no table -- which is
       * the honest value to record for a takeaway, rather than an invented
       * table. When the token is given it decides the restaurant, and the
       * slug is only checked for agreement.
       */
      place_public_order: {
        Args: {
          p_slug: string;
          p_lines: unknown; // jsonb: [{item_id, qty}]
          p_note?: string | null;
          p_session_token?: string | null;
        };
        Returns: string; // order code
      };
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
