# Migration `20261028000900_guest_scan_confirm.sql` — review pack

**Nothing in this document has been applied. It is the preparation you asked for
before approval.** File: `supabase/migrations/20261028000900_guest_scan_confirm.sql`
(602 lines, unapplied, never executed anywhere).

---

## 1. Exact contents

| # | statement | line | additive? |
| --- | --- | --- | --- |
| 1 | `alter table restaurants add column if not exists guest_verification_mode text not null default 'code' check (…in ('code','scan_confirm','scan'))` | 41 | yes |
| 2 | `comment on column` | 47 | yes |
| 3 | `alter table orders add column if not exists hold_required boolean not null default false, confirmed_at timestamptz, confirmed_by uuid, table_session_id uuid` | 58 | yes |
| 4 | 3 × `comment on column` | 64–74 | yes |
| 5 | `create index if not exists orders_held_idx on orders (restaurant_id, placed_at) where hold_required and confirmed_at is null` | 76 | yes (partial, tiny) |
| 6 | `create index if not exists orders_session_idx on orders (table_session_id) where table_session_id is not null` | 80 | yes |
| 7 | `create table if not exists table_session_opens (id, qr_code_id → table_qr_codes on delete cascade, ip_hash, opened_at)` | 92 | yes |
| 8 | 2 × `create index … table_session_opens` (card+time, ip+time) | 99–103 | yes |
| 9 | `alter table table_session_opens enable row level security` + `revoke all` from `anon`, `authenticated` | 105–108 | yes (no policies: function-only table) |
| 10 | `create or replace function open_table_session(text, text)` + comment + 5 grants | 123 | replaces nothing (new) |
| 11 | `create or replace function stamp_guest_verification(text, uuid, text)` + 3 revokes | 268 | new |
| 12 | `create or replace function place_public_order(text, jsonb, text, text, uuid)` | 333 | **replaces a live function** |
| 13 | `create or replace function confirm_table_orders(uuid)` + grants | 421 | new |
| 14 | `create or replace function reject_table_orders(uuid, text)` + grants | 473 | new |
| 15 | `create or replace function get_public_order(text, text, uuid)` | 547 | **replaces a live function** |

No `drop`, `drop column`, `truncate`, `delete`, `alter type`, or data rewrite
anywhere in the file. Verified by grep, not by eye.

## 2. Prerequisites — read this before anything else

### 2.1 The repository's migrations do not build the schema from empty

**This is the most important finding in this pack.** The migration depends on
three tables that **no migration in this repository creates**:

```
table_qr_codes            created-in-repo = 0
table_verification_sessions created-in-repo = 0
qr_verification_attempts  created-in-repo = 0
```

They exist in the deployed database and were never checked in. Consequence: a
"fresh" database built by replaying `supabase/migrations/*` will **fail** at
`20261021000006_table_qr_verification.sql` long before it reaches this file.
Any branch database must therefore be **cloned from the live schema**, not
rebuilt from the migrations. (`place_public_order_core` and
`restaurant_can_write` *are* created in-repo, so those are fine.)

### 2.2 What must already exist

| object | why | how to confirm |
| --- | --- | --- |
| `table_qr_codes(id, public_token, restaurant_id, table_id, revoked_at)` | scanned card lookup, FK for `table_session_opens` | `\d public.table_qr_codes` |
| `table_verification_sessions(id, token_hash, restaurant_id, table_id, qr_code_id, created_at, expires_at, revoked_at)` | the session this file mints | `\d public.table_verification_sessions` |
| `place_public_order_core(text, jsonb, text, text)` | the body `place_public_order` calls | `select proname from pg_proc where proname='place_public_order_core'` |
| `restaurant_can_write(uuid)` | the write gate used by all three new functions | same query |
| `memberships(restaurant_id, user_id, role)` with `member_role ∈ {owner, manager, kitchen, cashier}` | role checks in confirm/reject | `select enum_range(null::public.member_role)` |
| `orders.prep_status`, `orders.code`, `orders.guest_token`, `orders.customer_note` | read/written by the replaced functions | `\d public.orders` |
| `restaurants.slug`, `is_active`, `tax_rate_bps` | used by the order path | `\d public.restaurants` |
| Postgres ≥ 13 | `gen_random_uuid()` and `sha256()` are built in; no extension needed | `select version()` |

### 2.3 What must **not** be true

- `table_verification_sessions` must not have a `hold_orders` column yet (L1
  proposes adding one later — do not apply both in one go).
- No deployment should be depending on a *different* `place_public_order`
  signature; there is one caller (`lib/db/...` → RPC by name), and the body is
  diffed against `20261027000900` except for one `perform`.

## 3. Branch database — ₹0 paths

**Do not test this on production.** Two free routes; A is the one I recommend.

### A. A second free Supabase project as the branch (₹0, no Docker)

Free tier allows two projects; this uses the second.

```bash
# 1. Schema only, from the LIVE project. Never touches data.
pg_dump "$PROD_DB_URL" --schema=public --schema-only --no-owner --no-privileges \
  -f /tmp/autodine-schema.sql

# 2. Restore into the branch project (empty).
psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/autodine-schema.sql

# 3. Prove the branch is a faithful copy BEFORE migrating.
psql "$BRANCH_DB_URL" -c "select count(*) from pg_proc where pronamespace='public'::regnamespace;"
psql "$BRANCH_DB_URL" -c "select count(*) from pg_tables where schemaname='public';"
#    … compare with the same two numbers on production.

# 4. Apply the migration, in a transaction, on the branch only.
psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/20261028000900_guest_scan_confirm.sql

# 5. Optional but recommended: a demo restaurant so the flow can be clicked.
psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/demo/king-of-kings.sql

# 6. Run the app against the branch, locally, with its own keys.
#    .env.local only — never committed, never production keys.
NEXT_PUBLIC_SUPABASE_URL=…   # branch
NEXT_PUBLIC_SUPABASE_ANON_KEY=…  # branch
SUPABASE_SERVICE_ROLE_KEY=…  # branch (only if a local script needs it)
npm run dev
```

Notes that matter:

- `pg_dump --schema-only` prints **no rows**, so nothing personal leaves the
  production database.
- The branch project must have the same Postgres major version as production,
  or the restore will warn on collations and extensions.
- Do not reuse the production `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`; if it
  ever leaks from a laptop it is a full-database key.
- Delete the branch project when finished; it costs nothing but it holds a slot.

### B. Local Docker stack (₹0, needs Docker)

```bash
npx supabase start                     # per supabase/config.toml: PG 15, API 54321
psql "$LOCAL_DB_URL" -f /tmp/autodine-schema.sql   # same dump as above
psql "$LOCAL_DB_URL" --single-transaction -f supabase/migrations/20261028000900_guest_scan_confirm.sql
```

`npx supabase db reset` is **not** an option for this repo: it replays
`supabase/migrations` from empty, which fails at 20261021000006 for the reason
in §2.1.

## 4. Verification

### 4.1 Before applying (read-only)

```sql
-- must all be false
select column_name from information_schema.columns
 where table_schema='public'
   and ((table_name='restaurants' and column_name='guest_verification_mode')
     or (table_name='orders'      and column_name in
         ('hold_required','confirmed_at','confirmed_by','table_session_id'))
     or (table_name='table_verification_sessions' and column_name='hold_orders'));

-- must all be absent
select proname from pg_proc
 where pronamespace='public'::regnamespace
   and proname in ('open_table_session','stamp_guest_verification',
                   'confirm_table_orders','reject_table_orders');
```

### 4.2 After applying — objects

```sql
-- 1. columns and their defaults
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema='public'
   and ((table_name='restaurants' and column_name='guest_verification_mode')
     or (table_name='orders' and column_name in
         ('hold_required','confirmed_at','confirmed_by','table_session_id')))
 order by 1,2;
-- expect: guest_verification_mode text NOT NULL default 'code'
--         hold_required boolean NOT NULL default false, others nullable

-- 2. indexes
select indexname from pg_indexes
 where schemaname='public'
   and indexname in ('orders_held_idx','orders_session_idx',
                     'table_session_opens_card_idx','table_session_opens_ip_idx');
-- expect 4 rows

-- 3. the openers table is closed to clients
select relrowsecurity from pg_class where oid='public.table_session_opens'::regclass;   -- t
select count(*) from pg_policies
 where schemaname='public' and tablename='table_session_opens';                         -- 0
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema='public' and table_name='table_session_opens'
   and grantee in ('anon','authenticated');                                            -- 0 rows

-- 4. every function: definer, pinned path, right grants
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer,
       array_to_string(p.proconfig, ',')         as config
  from pg_proc p
 where p.pronamespace='public'::regnamespace
   and p.proname in ('open_table_session','stamp_guest_verification',
                     'confirm_table_orders','reject_table_orders',
                     'place_public_order','get_public_order')
 order by 1;
-- expect security_definer = t and config containing search_path=public

select has_function_privilege('anon','public.open_table_session(text,text)','execute') as anon_can_open,      -- t
       has_function_privilege('anon','public.confirm_table_orders(uuid)','execute')     as anon_can_confirm,   -- f
       has_function_privilege('authenticated','public.confirm_table_orders(uuid)','execute') as staff_can_confirm; -- t
```

### 4.3 After applying — behaviour (branch database only)

```sql
-- a real card to work with
select q.public_token, r.slug, r.guest_verification_mode
  from public.table_qr_codes q
  join public.restaurants r on r.id = q.restaurant_id
 where q.revoked_at is null
 limit 5;

-- (a) a code-mode restaurant must refuse to mint from a scan
select * from public.open_table_session('<token>', repeat('a',64));
-- expect status = 'code', session_token null

-- (b) flip one restaurant and try again
update public.restaurants set guest_verification_mode='scan_confirm'
 where slug='<slug>';
select * from public.open_table_session('<token>', repeat('a',64));
-- expect status = 'opened', 64-hex session_token, expires_at ≈ now()+59min
-- and exactly one row in table_session_opens

-- (c) the throttle is reached and says so, without raising
select status from public.open_table_session('<token>', repeat('b',64)) from generate_series(1,12);
-- expect 'opened' × remaining, then 'limited'; no exception

-- (d) a placed order is held and the kitchen can see it
--     (use the session token from (b) through the app, or:)
select hold_required, confirmed_at, table_session_id from public.orders
 where code = '<order code>';                        -- expect t / null / <session id>

-- (e) staff confirm releases the sitting
select public.confirm_table_orders('<session id>');  -- expect 1 on first call, 0 on the second
--   call it as a signed-in member of that restaurant, not as anonymous

-- (f) the guest read function gained two keys
select jsonb_object_keys(public.get_public_order('<slug>','<code>','<guest uuid>')) …;
-- expect hold_required and confirmed_at among the keys
```

### 4.4 End-to-end (the only check that proves the feature)

With the app pointed at the branch database: scan `/t/<token>` on a phone-sized
viewport → place an order → it appears in the kitchen's **"Waiting for the
floor"** strip, not in a cook's column → press Confirm → the guest's status page
changes from "waiting for the table to be confirmed" to "sent to the kitchen" →
place a second order in the same sitting → it is **not** held.

## 5. Rollback

Ordered, fastest first. Tier 1 and 2 need no SQL at all.

**Tier 1 — promote the previous deployment (Vercel → Deployments → Promote).**
Seconds. Reverts the application code; the database is untouched and the feature
is unreachable because nothing calls it.

**Tier 2 — turn the feature off with one row.** No deploy, no schema change:

```sql
update public.restaurants set guest_verification_mode = 'code';
```

Every restaurant is back to the rotating code immediately. Sessions already
minted stay valid until they expire (≤59 min). Held tickets stay on the board
until confirmed or rejected — both actions still work, because their functions
are present.

**Tier 3 — remove the SQL** (only if the schema itself must go; loses hold
metadata, no money and no order lines):

```sql
begin;

-- 1. restore the two replaced functions from the previous migration
\i supabase/migrations/20261027000900_idempotent_guest_orders.sql   -- replaces place_public_order + get_public_order

-- 2. drop what this migration added
drop function if exists public.confirm_table_orders(uuid);
drop function if exists public.reject_table_orders(uuid, text);
drop function if exists public.stamp_guest_verification(text, uuid, text);
drop function if exists public.open_table_session(text, text);

drop table if exists public.table_session_opens;

drop index if exists public.orders_held_idx;
drop index if exists public.orders_session_idx;

alter table public.orders
  drop column if exists table_session_id,
  drop column if exists confirmed_by,
  drop column if exists confirmed_at,
  drop column if exists hold_required;

alter table public.restaurants
  drop column if exists guest_verification_mode;

commit;
```

Dropping `orders.table_session_id` also drops anything that later started
depending on it — check with `pg_depend` first if L1 has been applied on top:

```sql
select distinct dependent.relname
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class dependent on dependent.oid = r.evrelid
 where d.refobjid = 'public.orders'::regclass;
```

## 6. Risk register

| risk | likelihood | impact | mitigation |
| --- | --- | --- | --- |
| migration applied to a database that lacks `table_qr_codes` etc. | medium if anyone tries a fresh DB | migration aborts on FK/relation, no partial damage | §2.1; run §4.1 first |
| deploy before migration, code asks for missing columns | high (this is the shipped order) | 42703 errors | already handled: kitchen + settings retry with legacy column lists and treat mode as `code` |
| migration before deploy | low | no caller uses the new columns; nothing breaks | additive only |
| `place_public_order` replacement diverges from the previous body | low | order path regressions | body diffed against `20261027000900`; one `perform` added; re-diff before applying |
| throttle bricks a table | **high today** | one table cannot order for an hour | L1 (docs/scan-limit-l1.md) — proposed, not applied |
| per-address limit bypassable via forged `x-forwarded-for` | certain | rate limit is advisory | documented in `lib/ip-hash.ts`; do not describe it as a control |
| a second staff member confirms twice | low | none | `confirmed_at is null` predicate → 0 rows |

## 7. What approval would cover

Applying §3 to a **branch** database and running §4. It would not cover
production. Production needs a separate decision after §4.4 passes, and it would
be: apply on prod during a quiet hour, then flip one pilot restaurant to
`scan_confirm` — never to `scan` first.


---

## 8. Reversibility and destructive changes (direct answer)

**Is the file reversible?** Yes, every part, but with one honest caveat: nothing
here is destructive *while it exists*, and the destructive act would be the
rollback, not the migration.

| change | reversible? | method | data lost on rollback |
| --- | --- | --- | --- |
| `restaurants.guest_verification_mode` | yes | `drop column` | the chosen mode for every restaurant (a setting, not a record) |
| `orders.hold_required / confirmed_at / confirmed_by / table_session_id` | yes | `drop column` | which sitting an order belonged to, and whether/when/by whom a human vouched for it |
| 2 partial indexes on `orders` | yes | `drop index` | nothing — derived from rows |
| `table_session_opens` (+2 indexes) | yes | `drop table` | the throttle's own history. This is the only table whose rows exist *only* for this feature |
| 4 new functions | yes | `drop function` | nothing |
| `place_public_order`, `get_public_order` (replaced) | yes | re-run `20261027000900` | nothing — but between the drop and the re-run, ordering is broken, so always restore first |

**What is destructive in this file: nothing.** There is no `drop`, `delete`,
`truncate`, `alter type`, or update of existing rows. Verified by grep over the
whole file, not by reading it. Applying it cannot lose an order, a payment, a
menu or a member.

**What is destructive on rollback:** dropping `orders.table_session_id` and the
`confirmed_at`/`confirmed_by` pair loses *provenance* — the answer to "did a
human accept this table, and who". It does not lose orders, money or lines. And
if L1 (`docs/scan-limit-l1.md`) has been applied on top, a
`table_verification_sessions.hold_orders` column would also need dropping; the
order matters (see the `pg_depend` query in §5).

**Ordering rule that matters more than either:** restore the two replaced
functions BEFORE dropping anything. If the columns are dropped while the new
`place_public_order` still calls `stamp_guest_verification`, the guest order
path fails on the next order placed.


---

## Appendix A — the exact SQL, statement by statement

The file is 602 lines and lives in the repository; reproducing it here would be a
copy that could drift. This is the index, with the short statements verbatim and
the long ones identified by their first and last line so any copy can be checked
against the source:

```bash
# the whole file, at the commit this review describes
git show 7e7173c:supabase/migrations/20261028000900_guest_scan_confirm.sql | less

# just the function bodies
git show 7e7173c:supabase/migrations/20261028000900_guest_scan_confirm.sql | sed -n '120,602p'
```

| lines | statement (verbatim where short) |
| --- | --- |
| 41–43 | `alter table public.restaurants add column if not exists guest_verification_mode text not null default 'code' check (guest_verification_mode in ('code', 'scan_confirm', 'scan'));` |
| 47–50 | `comment on column public.restaurants.guest_verification_mode is …` |
| 58–61 | `alter table public.orders add column if not exists hold_required boolean not null default false, add column if not exists confirmed_at timestamptz, add column if not exists confirmed_by uuid, add column if not exists table_session_id uuid;` |
| 62–74 | four `comment on column public.orders.…` |
| 76–78 | `create index if not exists orders_held_idx on public.orders (restaurant_id, placed_at) where hold_required and confirmed_at is null;` |
| 80–82 | `create index if not exists orders_session_idx on public.orders (table_session_id) where table_session_id is not null;` |
| 92–97 | `create table if not exists public.table_session_opens (id uuid primary key default gen_random_uuid(), qr_code_id uuid not null references public.table_qr_codes(id) on delete cascade, ip_hash text not null, opened_at timestamptz not null default now());` |
| 99–103 | `create index … table_session_opens_card_idx (qr_code_id, opened_at desc)` and `…_ip_idx (ip_hash, opened_at desc)` |
| 105–108 | `alter table public.table_session_opens enable row level security;` + `revoke all … from anon;` + `… from authenticated;` |
| 123–247 | `create or replace function public.open_table_session(p_public_token text, p_ip_hash text) returns table (status text, session_token text, restaurant_slug text, table_label text, expires_at timestamptz) language plpgsql security definer set search_path = public, pg_temp` |
| 249–252 | `comment on function public.open_table_session(text, text)` |
| 254–258 | three `revoke all … from public/anon/authenticated` + `grant execute … to anon` + `… to authenticated` |
| 268–320 | `create or replace function public.stamp_guest_verification(p_code text, p_restaurant_id uuid, p_session_token text) returns void` |
| 322–324 | three `revoke all …` (no grant: only `place_public_order` calls it) |
| 333–414 | `create or replace function public.place_public_order(p_slug text, p_lines jsonb, p_note text default null, p_session_token text default null, p_guest_token uuid default null) returns text` |
| 421–470 | `create or replace function public.confirm_table_orders(p_table_session_id uuid) returns integer` |
| 473–529 | `create or replace function public.reject_table_orders(p_table_session_id uuid, p_reason text default null) returns integer` |
| 531–539 | three `revoke all …` + `grant execute … to authenticated` for each of the two above |
| 547–596 | `create or replace function public.get_public_order(p_slug text, p_code text, p_token uuid) returns jsonb` |
| 598–602 | three `revoke all …` + `grant execute … to anon` + `… to authenticated` |

Every function above is `security definer` with `set search_path = public, pg_temp`
and an explicit `revoke`/`grant` pair. §4.2's query proves all three at once on a
real database, which is better than trusting the table above.
