# Kitchen announcement snapshot proposal (not applied)

**Status:** proposal only. No migration was added or executed, and no Supabase connection was used.

## Why a schema follow-up is needed

`order_items.name_snapshot`, `variant_snapshot`, and `addons_snapshot` already preserve the operational details used by the announcement. In contrast, the kitchen loader currently obtains a table label from mutable `dining_tables.label`, while custom pronunciation lives on mutable `items.spoken_name`. A later edit can therefore change how an older order is announced. The app now uses the order-time item-name/portion/add-on snapshots and no longer substitutes the current menu pronunciation. The table label still uses the current label until a snapshot exists.

## Proposed additive columns

```sql
alter table public.orders
  add column if not exists table_label_snapshot text;

alter table public.order_items
  add column if not exists spoken_name_snapshot text;
```

Keep both nullable: older rows may not have a recoverable historical value. At order creation, snapshot the dining table label (or `Takeaway`) onto `orders.table_label_snapshot`, and snapshot `items.spoken_name` onto `order_items.spoken_name_snapshot` alongside the existing name, variant, and add-on snapshots. The staff loader should prefer these snapshot values and fall back to the current table label / generated pronunciation only when the snapshot is null. Before changing any RPC, inventory every live `place_public_order` / order-creation function definition and update the authoritative definitions together; do not alter price, payment, validation, tenant, or authorization behavior.

## Preflight and verification SQL

Run read-only checks first in a non-production Supabase branch:

```sql
-- Confirm the objects and current snapshot columns exist.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('orders', 'order_items', 'dining_tables', 'items')
  and column_name in (
    'table_id', 'label', 'name_snapshot', 'variant_snapshot',
    'addons_snapshot', 'spoken_name'
  )
order by table_name, ordinal_position;

-- Estimate how much historical data is recoverable from mutable current rows.
select count(*) as orders_with_table,
       count(*) filter (where t.label is not null) as labels_recoverable
from public.orders o
left join public.dining_tables t on t.id = o.table_id;

select count(*) as order_items_with_item,
       count(*) filter (where i.spoken_name is not null and btrim(i.spoken_name) <> '') as pronunciations_recoverable
from public.order_items oi
left join public.items i on i.id = oi.item_id;

-- Enumerate order-creation RPC signatures before editing any function.
select p.oid::regprocedure as function_signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname ilike '%place%order%'
order by 1;
```

After an approved migration and RPC rollout, verify snapshot coverage and ensure existing tenant policies remain intact:

```sql
select count(*) as total,
       count(*) filter (where table_label_snapshot is not null) as table_snapshot_count
from public.orders;

select count(*) as total,
       count(*) filter (where spoken_name_snapshot is not null) as pronunciation_snapshot_count
from public.order_items;

select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('orders', 'order_items')
order by tablename, policyname;
```

Also place a test order in the non-production branch, edit the table label and menu pronunciation afterward, reload the kitchen board, and confirm the older ticket still uses its stored values. Verify a new table order, takeaway order, item with no pronunciation override, item with a saved pronunciation, portions, and multiple add-ons. Confirm existing order validation, totals, payment state, and RLS behavior are unchanged.

## Rollback / recovery

The additive columns can be rolled back with `alter table public.order_items drop column spoken_name_snapshot;` and `alter table public.orders drop column table_label_snapshot;` after reverting the loader and order-creation RPC code. This loses only the newly captured presentation metadata; it must not touch order rows, payment data, or existing snapshot columns. Back up the non-production branch and record the exact deployed RPC definitions before applying any future migration. Do not use `cascade`.

## Security and scope

No policy or grant change is proposed. These columns inherit the existing row-level security of `orders` and `order_items`; the loader must continue to query only the authenticated staff member's restaurant. No migration is to be applied until this proposal has been reviewed and approved.
