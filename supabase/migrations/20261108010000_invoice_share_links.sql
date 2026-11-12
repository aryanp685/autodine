-- Secure, revocable receipt-sharing credentials.
--
-- The raw random bearer token exists only in the server action response and
-- the browser URL. PostgreSQL stores only its SHA-256 digest. Public access is
-- limited to one issued receipt snapshot and its frozen lines; it cannot query
-- by invoice UUID, restaurant UUID, or session ID.

create table if not exists public.restaurant_invoice_share_links (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  invoice_id uuid not null references public.restaurant_invoices(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count bigint not null default 0 check (access_count >= 0),
  constraint restaurant_invoice_share_expiry_check check (expires_at > created_at),
  constraint restaurant_invoice_share_revoke_check check (revoked_at is null or revoked_at >= created_at)
);

create index if not exists restaurant_invoice_share_invoice_idx
  on public.restaurant_invoice_share_links (restaurant_id, invoice_id, created_at desc);
create index if not exists restaurant_invoice_share_expiry_idx
  on public.restaurant_invoice_share_links (expires_at)
  where revoked_at is null;

alter table public.restaurant_invoice_share_links enable row level security;
revoke all on public.restaurant_invoice_share_links from public, anon, authenticated, service_role;

create table if not exists public.restaurant_invoice_share_audit (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  invoice_id uuid not null references public.restaurant_invoices(id) on delete restrict,
  share_link_id uuid not null references public.restaurant_invoice_share_links(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('created', 'revoked', 'opened')),
  occurred_at timestamptz not null default statement_timestamp()
);

create index if not exists restaurant_invoice_share_audit_invoice_idx
  on public.restaurant_invoice_share_audit (restaurant_id, invoice_id, occurred_at desc);
alter table public.restaurant_invoice_share_audit enable row level security;
revoke all on public.restaurant_invoice_share_audit from public, anon, authenticated, service_role;

create or replace function public.create_restaurant_invoice_share_link(p_invoice_id uuid, p_token_hash text)
returns table (share_link_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_invoice public.restaurant_invoices%rowtype;
  v_link_id uuid;
  v_expiry timestamptz := statement_timestamp() + interval '24 hours';
begin
  if v_actor is null then
    raise exception 'Sign in to create a receipt link.' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid receipt-link token.' using errcode = '22023';
  end if;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.id = p_invoice_id
   for share;
  if not found then
    raise exception 'Receipt not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_invoice.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to share this receipt.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_invoice.restaurant_id) then
    raise exception 'This restaurant is read-only. Restore access before creating a share link.' using errcode = 'P0001';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'Only an issued receipt can be shared.' using errcode = 'P0001';
  end if;

  insert into public.restaurant_invoice_share_links (
    restaurant_id, invoice_id, token_hash, created_by, expires_at
  ) values (
    v_invoice.restaurant_id, v_invoice.id, p_token_hash, v_actor, v_expiry
  ) returning id into v_link_id;

  insert into public.restaurant_invoice_share_audit (
    restaurant_id, invoice_id, share_link_id, actor_id, event_type
  ) values (v_invoice.restaurant_id, v_invoice.id, v_link_id, v_actor, 'created');

  return query select v_link_id, v_expiry;
end;
$$;

revoke all on function public.create_restaurant_invoice_share_link(uuid, text) from public, anon;
grant execute on function public.create_restaurant_invoice_share_link(uuid, text) to authenticated;

create or replace function public.revoke_restaurant_invoice_share_link(p_share_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_link public.restaurant_invoice_share_links%rowtype;
  v_role public.member_role;
begin
  if v_actor is null then
    raise exception 'Sign in to revoke a receipt link.' using errcode = '42501';
  end if;

  select l.* into v_link
    from public.restaurant_invoice_share_links l
   where l.id = p_share_link_id
   for update;
  if not found then
    return false;
  end if;
  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_link.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to revoke this receipt link.' using errcode = '42501';
  end if;

  if v_link.revoked_at is null then
    update public.restaurant_invoice_share_links
       set revoked_at = statement_timestamp()
     where id = v_link.id;
    insert into public.restaurant_invoice_share_audit (
      restaurant_id, invoice_id, share_link_id, actor_id, event_type
    ) values (v_link.restaurant_id, v_link.invoice_id, v_link.id, v_actor, 'revoked');
  end if;
  return true;
end;
$$;

revoke all on function public.revoke_restaurant_invoice_share_link(uuid) from public, anon;
grant execute on function public.revoke_restaurant_invoice_share_link(uuid) to authenticated;

create or replace function public.list_restaurant_invoice_share_links(p_invoice_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_role public.member_role;
begin
  if v_actor is null then
    raise exception 'Sign in to view receipt links.' using errcode = '42501';
  end if;
  select i.restaurant_id into v_restaurant_id
    from public.restaurant_invoices i where i.id = p_invoice_id;
  if not found then return; end if;
  select m.role into v_role from public.memberships m
   where m.restaurant_id = v_restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to view receipt links.' using errcode = '42501';
  end if;
  return query
    select l.id, l.created_at, l.expires_at, l.revoked_at, l.last_accessed_at, l.access_count
      from public.restaurant_invoice_share_links l
     where l.invoice_id = p_invoice_id and l.restaurant_id = v_restaurant_id
     order by l.created_at desc;
end;
$$;

revoke all on function public.list_restaurant_invoice_share_links(uuid) from public, anon;
grant execute on function public.list_restaurant_invoice_share_links(uuid) to authenticated;

create or replace function public.read_shared_restaurant_invoice(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.restaurant_invoice_share_links%rowtype;
  v_invoice public.restaurant_invoices%rowtype;
  v_lines jsonb;
  v_timezone text;
  v_allowed boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;

  select h.allowed into v_allowed
    from public.hit_rate_limit('receipt-share:view:' || substr(p_token_hash, 1, 32), 60, 60) h;
  if not coalesce(v_allowed, false) then return null; end if;

  select l.* into v_link
    from public.restaurant_invoice_share_links l
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and l.expires_at > statement_timestamp()
   for update;
  if not found then return null; end if;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.id = v_link.invoice_id
     and i.restaurant_id = v_link.restaurant_id
     and i.status = 'issued';
  if not found then return null; end if;

  select coalesce(nullif(r.timezone, ''), 'Asia/Kolkata') into v_timezone
    from public.restaurants r where r.id = v_invoice.restaurant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', il.id,
    'line_snapshot', il.line_snapshot
  ) order by il.line_number), '[]'::jsonb)
    into v_lines
    from public.restaurant_invoice_lines il
   where il.invoice_id = v_invoice.id
     and il.restaurant_id = v_invoice.restaurant_id;

  update public.restaurant_invoice_share_links
     set last_accessed_at = statement_timestamp(), access_count = access_count + 1
   where id = v_link.id;
  insert into public.restaurant_invoice_share_audit (
    restaurant_id, invoice_id, share_link_id, actor_id, event_type
  ) values (v_link.restaurant_id, v_invoice.id, v_link.id, auth.uid(), 'opened');

  return jsonb_build_object(
    'timezone', v_timezone,
    'invoice', jsonb_build_object(
      'id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'financial_year', v_invoice.financial_year,
      'document_type', v_invoice.document_type,
      'status', v_invoice.status,
      'issued_at', v_invoice.issued_at,
      'table_label_snapshot', v_invoice.table_label_snapshot,
      'order_session_id', v_invoice.order_session_id,
      'session_opened_at', v_invoice.session_opened_at,
      'session_closed_at', v_invoice.session_closed_at,
      'seller_snapshot', v_invoice.seller_snapshot,
      'totals_snapshot', v_invoice.totals_snapshot,
      'payment_snapshot', v_invoice.payment_snapshot,
      'supersedes_invoice_id', v_invoice.supersedes_invoice_id,
      'void_reason', v_invoice.void_reason
    ),
    'lines', v_lines
  );
end;
$$;

revoke all on function public.read_shared_restaurant_invoice(text) from public, authenticated;
grant execute on function public.read_shared_restaurant_invoice(text) to anon, authenticated;

comment on table public.restaurant_invoice_share_links is
  'Hashed, revocable 24-hour bearer credentials for one issued immutable receipt; raw tokens are never persisted.';
comment on table public.restaurant_invoice_share_audit is
  'Append-only audit of receipt share-link creation, revocation and public opens.';
comment on function public.read_shared_restaurant_invoice(text) is
  'Returns only the receipt snapshot bound to a valid, unexpired, unrevoked opaque share token; never accepts an invoice or tenant id.';
