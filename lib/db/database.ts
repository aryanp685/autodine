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
  ItemAddon,
  ItemAddonGroup,
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
      item_addon_groups: Table<ItemAddonGroup>;
      item_addons: Table<ItemAddon>;
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
        /** The provider's id for the attempt, e.g. Razorpay order_... */
        provider_ref: string | null;
        /** The provider's id for the money, e.g. Razorpay pay_.... Migration 00800. */
        provider_payment_ref: string | null;
        idempotency_key: string | null;
        created_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      /**
       * Whether writes are allowed for this restaurant right now.
       *
       * False once a trial has ended with no active subscription. Every write
       * policy on the staff tables is written as
       * `has_restaurant_role(...) and restaurant_can_write(restaurant_id)`, so
       * this is the single question a screen has to ask before offering a
       * button that writes. Signature checked against the live database.
       */
      restaurant_can_write: {
        Args: { p_restaurant_id: string };
        Returns: boolean;
      };
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
       * Migration 20261023000900. What a scanned card is for, before anything
       * is proved: restaurant name, table label, and how often the on-site
       * code changes.
       *
       * Returns NO ROW rather than an error for a token that is unknown,
       * revoked, or belongs to a table that is out of service -- the
       * verification screen needs to distinguish "not a table" from "you
       * typed the code wrong", and a raised exception would collapse both
       * into one.
       *
       * Creates nothing and grants nothing.
       */
      public_qr_intro: {
        Args: { p_public_token: string };
        Returns: {
          restaurant_slug: string;
          restaurant_name: string;
          table_label: string;
          window_seconds: number;
        }[];
      };
      /**
       * Migration 20261023000900. THE ONLY WAY a table session is minted.
       *
       * Replaces verify_table_qr, which this migration drops: that function
       * took a scanned token as sufficient proof, so a photograph of a card
       * ordered from anywhere. This one also requires the short code showing
       * on a screen inside the restaurant.
       *
       * The token in the URL is printed on the table and is not a secret.
       * What comes back on success is: 64 hex characters, generated inside
       * the database, handed over once and stored there only as a SHA-256
       * hash. It expires after 59 minutes, and revoking the QR code revokes
       * every session issued against it.
       *
       * FAILURES COME BACK AS A STATUS, NOT AS AN ERROR
       *
       * An earlier version raised P0001, which rolled back the rate-limit
       * attempt it had just recorded -- so a wrong code left no trace and the
       * limiter could never fire. This one returns a row every time.
       *
       *   ok          session_token etc. are set
       *   unreadable  not a card token
       *   revoked     card or table out of service
       *   notserving  restaurant paused or read-only
       *   nomenu      nothing published
       *   nosetup     the restaurant has no on-site code yet
       *   limited     too many attempts from this address
       *   wrong       digits did not match; code_rotated says whether that
       *               wrong code was the one that replaced the secret
       *
       * p_ip_hash must be 64 hex characters -- sha256 of the caller's
       * address, salted with the token. Rate limited per code and per IP
       * hash: five attempts in fifteen minutes, then a fifteen minute block.
       * A wrong code also counts against the restaurant: twenty inside one
       * code window rotates the secret, which is what stops a guesser with
       * many addresses from working through a million combinations.
       *
       * Anything that is not a guest-caused failure (a constraint, a
       * permission error) still raises, and the caller turns that into one
       * fixed sentence.
       */
      verify_table_qr_with_code: {
        Args: {
          p_public_token: string;
          p_code: string;
          p_ip_hash: string;
        };
        Returns: {
          /** See the list above. Kept as string: a status added later must
           *  not break the build, it must fall through to the failure page. */
          status: string;
          session_token: string | null;
          restaurant_slug: string | null;
          table_label: string | null;
          expires_at: string | null;
          retry_after_seconds: number | null;
          code_rotated: boolean | null;
        }[];
      };
      /**
       * Migration 20261023000900. The read gate.
       *
       * Resolves a cookie's token against the live database -- expiry,
       * revocation, table still active, card still live, restaurant still
       * open. Returns no row for anything that does not hold, which is why
       * every guest page asks this instead of trusting the cookie.
       *
       * Granted to anon: a guest has no account, and the token itself is the
       * only credential it will ever have.
       */
      current_table_session: {
        Args: { p_token: string };
        Returns: {
          restaurant_id: string;
          restaurant_slug: string;
          table_id: string;
          table_label: string;
          expires_at: string;
        }[];
      };
      /**
       * Migration 20261023000900. The six digits showing on the screen inside
       * the restaurant, for staff to read out or point at.
       *
       * Granted to authenticated only, and SECURITY DEFINER with a membership
       * check in the body: under definer rights RLS is suspended, so the body
       * is the only thing between a signed-in caller and another restaurant's
       * secret. A guest must never be able to call this -- if they could, the
       * code would prove nothing.
       *
       * Creates the restaurant's secret on first call, so a restaurant that
       * has never opened this screen can still show a code.
       */
      current_verification_code: {
        Args: { p_restaurant_id: string };
        Returns: {
          code: string;
          expires_at: string;
          window_seconds: number;
        }[];
      };
      /**
       * Migration 20261023000900. A new secret, therefore a new code, without
       * waiting for the window to roll. Owner and manager only -- it is the
       * way a code that leaked (someone read it out over the phone) is taken
       * out of service.
       *
       * Rotating does not revoke sessions already issued: the guest at that
       * table has proved presence and keeps their hour.
       */
      rotate_verification_code: {
        Args: { p_restaurant_id: string };
        Returns: {
          code: string;
          expires_at: string;
          window_seconds: number;
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
       * 'That table does not exist.' -- staff-facing, unlike the guest path,
       * which returns status words and never raises for anything a guest can
       * cause.
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
       * verify_table_qr_with_code and the order is stamped with that table,
       * which is what lets the kitchen board say which table a ticket belongs
       * to. Migration 20261023000900 makes it REQUIRED here: this is the
       * signed-out guest path, and a guest who has not proved they are in the
       * restaurant has no business creating an order. Staff counter orders go
       * through place_counter_order, which needs no table session and is
       * untouched. The token decides the restaurant, and the slug is only
       * checked for agreement.
       */
      place_public_order: {
        Args: {
          p_slug: string;
          p_lines: unknown; // jsonb: [{item_id, qty}]
          p_note?: string | null;
          p_session_token?: string | null;
          /**
           * Migration 00600. The guest's own credential for the order, made by
           * the caller and stored on the row. Without it the order is created
           * but the guest cannot read, change or cancel it afterwards.
           */
          p_guest_token?: string | null;
        };
        Returns: string; // order code
      };
      /**
       * Migration 20261022000800. What this guest still owes, and whether the
       * restaurant has switched online payment on.
       *
       * SECURITY DEFINER, granted to service_role only: the browser reaches it
       * through a server action. The guest token is the credential; a wrong
       * token returns null, never an error that distinguishes the two cases.
       */
      public_online_due: {
        Args: { p_slug: string; p_code: string; p_token: string };
        Returns: unknown;
      };
      /**
       * Migration 20261022000800. Record an online attempt as pending, after
       * the provider has issued its own order id.
       *
       * The amount must equal the outstanding balance computed here, so a
       * provider order created for a stale amount cannot be attached.
       * Idempotent on (provider, provider_order_ref).
       */
      begin_online_payment: {
        Args: {
          p_provider: string;
          p_provider_order_ref: string;
          p_slug: string;
          p_order_id: string;
          p_guest_token: string;
          p_amount_paise: number;
        };
        Returns: string; // payment id
      };
      /**
       * Migration 20261022000800. Settle: the money is real.
       *
       * Called only after a signature has been verified — the checkout
       * callback with the key secret, the webhook with the webhook secret.
       * Idempotent on the provider order id, because both fire for the same
       * payment and only the first one should move anything.
       *
       * A null p_amount_paise means "the attempt's own amount" and is what the
       * checkout callback sends; the webhook sends the provider's number and
       * is held to it.
       */
      settle_online_payment: {
        Args: {
          p_provider: string;
          p_provider_order_ref: string;
          p_provider_payment_ref: string;
          p_amount_paise?: number | null;
        };
        Returns: string; // payment id
      };
      /**
       * Migration 00600. One order, for its guest.
       *
       * SECURITY DEFINER and gated on the token: the guest has no session, so
       * the token is the credential. Returns null when the token does not
       * match, which is also what a wrong code returns -- never confirm which.
       *
       * jsonb rather than a row set, so the lines arrive with the order in one
       * round trip. The shape is described by PublicOrderPayload in
       * lib/db/order-screen.ts.
       */
      get_public_order: {
        Args: { p_slug: string; p_code: string; p_token: string };
        Returns: unknown;
      };
      /**
       * Migration 00600. Cancel, as the guest (token) or as staff (session).
       *
       * Refuses a paid order for everyone: undoing money is a refund, and this
       * build has none. Refuses a guest outside ten minutes or after the
       * kitchen has started. Cancelling twice returns already = true rather
       * than raising, because two people press the same button.
       */
      cancel_order: {
        Args: {
          p_order_id: string;
          p_guest_token?: string | null;
          p_reason?: string | null;
        };
        Returns: unknown;
      };
      /**
       * Migration 00600. Change quantities on a ticket the kitchen has not
       * started. Pure arithmetic on the order's own snapshots: no menu is read
       * and no price comes from the caller.
       */
      set_order_line_quantities: {
        Args: {
          p_order_id: string;
          p_lines: unknown; // jsonb: [{line_id, qty}] -- qty 0 removes the line
          p_guest_token?: string | null;
        };
        Returns: unknown;
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
      /**
       * Migration 00700. Open a second, third ... outlet on the same account.
       *
       * SECURITY DEFINER because there is no INSERT policy on restaurants: the
       * function creates the restaurant, an owner membership and a starter
       * menu in one transaction, validates the name and slug itself, and
       * refuses once the caller owns MAX_OUTLETS_PER_OWNER restaurants.
       */
      create_outlet: {
        Args: {
          p_name: string;
          p_slug: string;
        };
        Returns: string; // new restaurant id (uuid)
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
