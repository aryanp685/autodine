-- AutoDine — printed table QR + venue rotating verification code.
-- Additive migration: legacy qr_tokens remain untouched. Active compatible
-- legacy identifiers are copied into table_qr_codes, where the rotating code
-- and a server-validated session are still mandatory before order placement.

-- Existing deployments may not yet have this composite key; the IDs remain
-- unchanged. It lets the new tables enforce that table and restaurant match.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dining_tables_id_restaurant_unique'
      and conrelid = 'public.dining_tables'::regclass
  ) then
    alter table public.dining_tables
      add constraint dining_tables_id_restaurant_unique unique (id, restaurant_id);
  end if;
end;
$$;

create table if not exists public.table_qr_codes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null,
  public_token text not null unique
    check (public_token ~ '^[A-Za-z0-9_-]{16,128}$'),
  source_qr_token_id uuid unique references public.qr_tokens(id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  constraint table_qr_codes_table_restaurant_fkey
    foreign key (table_id, restaurant_id)
    references public.dining_tables(id, restaurant_id) on delete cascade
);

create index if not exists table_qr_codes_table_active_idx
  on public.table_qr_codes(table_id) where revoked_at is null;

create table if not exists public.restaurant_verification_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  code_version bigint not null default 1 check (code_version > 0),
  cashier_access_enabled boolean not null default false,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.table_verification_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null,
  qr_code_id uuid not null references public.table_qr_codes(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint table_verification_sessions_table_restaurant_fkey
    foreign key (table_id, restaurant_id)
    references public.dining_tables(id, restaurant_id) on delete cascade,
  constraint table_verification_sessions_expiry_check check (expires_at > created_at),
  constraint table_verification_sessions_max_ttl_check
    check (expires_at <= created_at + interval '60 minutes')
);

create index if not exists table_verification_sessions_table_active_idx
  on public.table_verification_sessions(table_id, expires_at)
  where revoked_at is null;

-- The HMAC fingerprint is short-lived; raw client IPs are never stored.
create table if not exists public.qr_verification_attempts (
  qr_code_id uuid not null references public.table_qr_codes(id) on delete cascade,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  window_started_at timestamptz not null default statement_timestamp(),
  blocked_until timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (qr_code_id, ip_hash)
);
create index if not exists qr_verification_attempts_expiry_idx
  on public.qr_verification_attempts(updated_at);

-- Audit/report rows contain only legacy row IDs and a reason, never token text.
create table if not exists public.qr_token_migration_issues (
  legacy_qr_token_id uuid primary key,
  reason text not null check (reason in (
    'expired', 'inactive_table', 'inactive_restaurant', 'invalid_token_format', 'duplicate_token'
  )),
  recorded_at timestamptz not null default statement_timestamp()
);

-- Preserve only valid, live legacy QR identifiers. Old tokens were short-lived;
-- the copied public identifier becomes a persistent printed QR handle, but is
-- never sufficient to establish a guest session or place an order.
insert into public.table_qr_codes(
  restaurant_id, table_id, public_token, source_qr_token_id, created_at
)
select qt.restaurant_id, qt.table_id, qt.token, qt.id, statement_timestamp()
from public.qr_tokens qt
join public.dining_tables t on t.id = qt.table_id and t.restaurant_id = qt.restaurant_id
join public.restaurants r on r.id = qt.restaurant_id
where qt.expires_at > statement_timestamp()
  and t.is_active
  and r.is_active
  and qt.token ~ '^[A-Za-z0-9_-]{16,128}$'
on conflict do nothing;

-- Record every legacy row that was not safely copied, so an operator can
-- inspect the exact IDs without exposing the token value. Expiry is the legacy
-- representation of both expiry and revocation; 0001 had no revoked_at field.
insert into public.qr_token_migration_issues(legacy_qr_token_id, reason)
select qt.id,
  case
    when qt.expires_at <= statement_timestamp() then 'expired'
    when not coalesce(t.is_active, false) then 'inactive_table'
    when not coalesce(r.is_active, false) then 'inactive_restaurant'
    when qt.token !~ '^[A-Za-z0-9_-]{16,128}$' then 'invalid_token_format'
    else 'duplicate_token'
  end
from public.qr_tokens qt
left join public.dining_tables t on t.id = qt.table_id and t.restaurant_id = qt.restaurant_id
left join public.restaurants r on r.id = qt.restaurant_id
where not exists (
  select 1 from public.table_qr_codes q
  where q.source_qr_token_id = qt.id
)
on conflict (legacy_qr_token_id) do nothing;

alter table public.table_qr_codes enable row level security;
alter table public.restaurant_verification_settings enable row level security;
alter table public.table_verification_sessions enable row level security;
alter table public.qr_verification_attempts enable row level security;
alter table public.qr_token_migration_issues enable row level security;

revoke all on table public.table_qr_codes,
  public.restaurant_verification_settings,
  public.table_verification_sessions,
  public.qr_verification_attempts,
  public.qr_token_migration_issues
from public, anon, authenticated;
grant select, insert, update, delete on table public.table_qr_codes,
  public.restaurant_verification_settings,
  public.table_verification_sessions,
  public.qr_verification_attempts,
  public.qr_token_migration_issues to service_role;

-- One atomic reservation per incoming verification. Row locking serializes
-- concurrent requests for the same QR + keyed IP bucket. The first five are
-- allowed; a sixth is rejected until the rolling 15-minute window resets.
create or replace function public.reserve_qr_verification_attempt(
  p_qr_code_id uuid,
  p_ip_hash text
) returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.qr_verification_attempts%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit fingerprint.' using errcode = '22023';
  end if;

  insert into public.qr_verification_attempts(qr_code_id, ip_hash)
  values (p_qr_code_id, p_ip_hash)
  on conflict (qr_code_id, ip_hash) do nothing;

  select * into v_row
  from public.qr_verification_attempts a
  where a.qr_code_id = p_qr_code_id and a.ip_hash = p_ip_hash
  for update;

  if not found then
    raise exception 'Unknown table QR code.' using errcode = 'P0002';
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;

  if v_row.window_started_at <= v_now - interval '15 minutes' then
    update public.qr_verification_attempts
      set attempt_count = 1,
          window_started_at = v_now,
          blocked_until = null,
          updated_at = v_now
      where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
    return query select true, 0;
    return;
  end if;

  if v_row.attempt_count >= 5 then
    update public.qr_verification_attempts
      set blocked_until = coalesce(blocked_until, v_now + interval '15 minutes'),
          updated_at = v_now
      where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash
      returning public.qr_verification_attempts.blocked_until into v_row.blocked_until;
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;

  update public.qr_verification_attempts
    set attempt_count = attempt_count + 1,
        updated_at = v_now
    where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
  return query select true, 0;
end;
$$;

create or replace function public.record_qr_verification_failure(
  p_qr_code_id uuid,
  p_ip_hash text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blocked boolean;
begin
  update public.qr_verification_attempts a
    set blocked_until = case when a.attempt_count >= 5
      then statement_timestamp() + interval '15 minutes' else a.blocked_until end,
        updated_at = statement_timestamp()
    where a.qr_code_id = p_qr_code_id and a.ip_hash = p_ip_hash
    returning a.blocked_until > statement_timestamp() into v_blocked;
  return coalesce(v_blocked, false);
end;
$$;

create or replace function public.clear_qr_verification_attempts(
  p_qr_code_id uuid,
  p_ip_hash text
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.qr_verification_attempts
  where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
$$;

create or replace function public.cleanup_expired_qr_verification_attempts()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.qr_verification_attempts
  where updated_at < statement_timestamp() - interval '23 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.rotate_restaurant_verification_code(p_restaurant_id uuid, p_actor_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version bigint;
begin
  insert into public.restaurant_verification_settings(restaurant_id, code_version, updated_at, updated_by)
    values (p_restaurant_id, 2, statement_timestamp(), p_actor_id)
  on conflict (restaurant_id) do update
    set code_version = public.restaurant_verification_settings.code_version + 1,
        updated_at = statement_timestamp(),
        updated_by = p_actor_id
  returning code_version into v_version;
  return v_version;
end;
$$;

create or replace function public.issue_table_qr_code(
  p_restaurant_id uuid,
  p_table_id uuid,
  p_public_token text,
  p_actor_id uuid
) returns public.table_qr_codes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result public.table_qr_codes%rowtype;
begin
  if p_public_token is null or p_public_token !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid table QR token.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.restaurants r
    join public.dining_tables t on t.restaurant_id = r.id
    where r.id = p_restaurant_id and r.is_active
      and t.id = p_table_id and t.is_active
  ) then
    raise exception 'Restaurant or table is inactive or unavailable.' using errcode = 'P0002';
  end if;

  update public.table_qr_codes
  set revoked_at = statement_timestamp()
  where restaurant_id = p_restaurant_id and table_id = p_table_id and revoked_at is null;
  insert into public.table_qr_codes(restaurant_id, table_id, public_token, created_by)
  values (p_restaurant_id, p_table_id, p_public_token, p_actor_id)
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.revoke_table_qr_code(
  p_restaurant_id uuid,
  p_qr_code_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.table_qr_codes
    set revoked_at = coalesce(revoked_at, statement_timestamp())
    where id = p_qr_code_id and restaurant_id = p_restaurant_id;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.revoke_sessions_for_ineligible_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_active and not new.is_active then
    if tg_table_name = 'dining_tables' then
      update public.table_verification_sessions
      set revoked_at = coalesce(revoked_at, statement_timestamp())
      where table_id = new.id and restaurant_id = new.restaurant_id and revoked_at is null;
    elsif tg_table_name = 'restaurants' then
      update public.table_verification_sessions
      set revoked_at = coalesce(revoked_at, statement_timestamp())
      where restaurant_id = new.id and revoked_at is null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists revoke_table_sessions_on_disable on public.dining_tables;
create trigger revoke_table_sessions_on_disable
  after update of is_active on public.dining_tables
  for each row execute function public.revoke_sessions_for_ineligible_target();
drop trigger if exists revoke_restaurant_sessions_on_disable on public.restaurants;
create trigger revoke_restaurant_sessions_on_disable
  after update of is_active on public.restaurants
  for each row execute function public.revoke_sessions_for_ineligible_target();

create or replace function public.revoke_sessions_on_qr_revocation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    update public.table_verification_sessions
      set revoked_at = coalesce(revoked_at, statement_timestamp())
      where qr_code_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists revoke_sessions_on_qr_revoke on public.table_qr_codes;
create trigger revoke_sessions_on_qr_revoke
  after update of revoked_at on public.table_qr_codes
  for each row execute function public.revoke_sessions_on_qr_revocation();

revoke all on function public.issue_table_qr_code(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_table_qr_code(uuid, uuid) from public, anon, authenticated;
revoke all on function public.revoke_sessions_for_ineligible_target() from public, anon, authenticated;
revoke all on function public.revoke_sessions_on_qr_revocation() from public, anon, authenticated;
grant execute on function public.issue_table_qr_code(uuid, uuid, text, uuid) to service_role;
grant execute on function public.revoke_table_qr_code(uuid, uuid) to service_role;

revoke all on function public.reserve_qr_verification_attempt(uuid, text) from public, anon, authenticated;
revoke all on function public.record_qr_verification_failure(uuid, text) from public, anon, authenticated;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from public, anon, authenticated;
revoke all on function public.cleanup_expired_qr_verification_attempts() from public, anon, authenticated;
revoke all on function public.rotate_restaurant_verification_code(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_qr_verification_attempt(uuid, text) to service_role;
grant execute on function public.record_qr_verification_failure(uuid, text) to service_role;
grant execute on function public.clear_qr_verification_attempts(uuid, text) to service_role;
grant execute on function public.cleanup_expired_qr_verification_attempts() to service_role;
grant execute on function public.rotate_restaurant_verification_code(uuid, uuid) to service_role;

-- Replace the legacy anonymous RPC. It accepted a table token alone, which is
-- no longer sufficient. Only the trusted server action calls this signature.
drop function if exists public.place_order(text, text, jsonb, text);
drop function if exists public.place_order(text, jsonb, text);

create function public.place_order(
  p_session_token text,
  p_items jsonb,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.table_verification_sessions%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_table public.dining_tables%rowtype;
  v_qr public.table_qr_codes%rowtype;
  v_order_id uuid;
  v_code text;
  v_subtotal bigint := 0;
  v_tax bigint := 0;
  v_rate integer;
  v_entry jsonb;
  v_item public.items%rowtype;
  v_variant public.item_variants%rowtype;
  v_unit bigint;
  v_qty integer;
  v_variant_name text;
  v_addons text[];
  v_lines jsonb;
begin
  if p_session_token is null or p_session_token !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'Your table verification has expired. Please get the current code from restaurant staff.' using errcode = '42501';
  end if;

  select s.* into v_session
  from public.table_verification_sessions s
  where s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and s.expires_at > statement_timestamp()
    and s.revoked_at is null;

  if not found then
    raise exception 'Your table verification has expired. Please get the current code from restaurant staff.' using errcode = '42501';
  end if;

  select q.* into v_qr
  from public.table_qr_codes q
  where q.id = v_session.qr_code_id
    and q.table_id = v_session.table_id
    and q.restaurant_id = v_session.restaurant_id
    and q.revoked_at is null;
  if not found then
    raise exception 'Your table verification is no longer valid. Please get the current code from restaurant staff.' using errcode = '42501';
  end if;

  select * into v_table
  from public.dining_tables t
  where t.id = v_session.table_id
    and t.restaurant_id = v_session.restaurant_id
    and t.is_active;
  if not found then
    raise exception 'This table is not accepting orders. Please ask restaurant staff.' using errcode = 'P0002';
  end if;

  select * into v_restaurant
  from public.restaurants r
  where r.id = v_session.restaurant_id and r.is_active;
  if not found then
    raise exception 'This restaurant is not accepting orders. Please ask restaurant staff.' using errcode = 'P0002';
  end if;

  if not public.restaurant_can_write(v_restaurant.id) then
    raise exception 'This restaurant is in read-only mode. Existing data is safe; contact the restaurant to restore ordering.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.menus m
    where m.restaurant_id = v_restaurant.id and m.is_published
  ) then
    raise exception 'The menu is not currently available for ordering.' using errcode = 'P0002';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your order is empty.' using errcode = 'P0002';
  end if;

  v_lines := '[]'::jsonb;
  for v_entry in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_entry->>'qty')::integer;
    if v_qty is null or v_qty <= 0 or v_qty > 99 then
      raise exception 'Invalid quantity.' using errcode = 'P0002';
    end if;

    select i.* into v_item
    from public.items i
    join public.categories c
      on c.id = i.category_id and c.restaurant_id = v_restaurant.id
    join public.menus m
      on m.id = c.menu_id and m.restaurant_id = v_restaurant.id and m.is_published
    where i.id = (v_entry->>'item_id')::uuid
      and i.restaurant_id = v_restaurant.id
      and i.is_available;
    if not found then
      raise exception 'An item in your order is no longer available.' using errcode = 'P0002';
    end if;

    if v_entry->>'variant_id' is not null then
      select * into v_variant
      from public.item_variants v
      where v.id = (v_entry->>'variant_id')::uuid and v.item_id = v_item.id;
      if not found then
        raise exception 'Invalid variant.' using errcode = 'P0002';
      end if;
      v_unit := v_variant.price_paise;
      v_variant_name := v_variant.name;
    else
      v_unit := v_item.price_paise;
      v_variant_name := null;
    end if;

    v_addons := coalesce(
      (select array_agg(a) from jsonb_array_elements_text(coalesce(v_entry->'addons', '[]'::jsonb)) a),
      '{}'::text[]);
    v_subtotal := v_subtotal + (v_unit * v_qty::bigint);
    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.id, 'name', v_item.name, 'unit', v_unit,
      'qty', v_qty, 'variant', v_variant_name, 'addons', to_jsonb(v_addons), 'veg', v_item.is_veg
    );
  end loop;

  v_rate := coalesce(v_restaurant.tax_rate_bps, 500);
  v_tax := round(v_subtotal::numeric * v_rate / 10000.0)::bigint;
  v_code := upper(substr(md5(random()::text), 1, 3));

  insert into public.orders(
    restaurant_id, table_id, code, customer_note, prep_status, payment_status,
    subtotal_paise, discount_paise, tax_paise, total_paise
  ) values (
    v_restaurant.id, v_table.id, v_code, p_note, 'new', 'pending',
    v_subtotal, 0, v_tax, v_subtotal + v_tax
  ) returning id into v_order_id;

  insert into public.order_items(
    order_id, item_id, name_snapshot, unit_price_paise, qty,
    variant_snapshot, addons_snapshot, is_veg, sort_order
  )
  select v_order_id, (l->>'item_id')::uuid, l->>'name', (l->>'unit')::bigint,
    (l->>'qty')::integer, l->>'variant',
    coalesce((select array_agg(a) from jsonb_array_elements_text(coalesce(l->'addons', '[]'::jsonb)) a), '{}'::text[]),
    (l->>'veg')::boolean, t.ord::integer
  from jsonb_array_elements(v_lines) with ordinality as t(l, ord);

  return v_order_id;
end;
$$;

revoke all on function public.place_order(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.place_order(text, jsonb, text) to service_role;
