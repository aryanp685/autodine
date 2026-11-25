-- In-app review capture behind the Google review invitation.
--
-- The invitation sheet used to be a pass-through: the guest tapped stars that
-- went nowhere and was sent on to Google. Now the sheet also takes an
-- optional note and submits the rating to the restaurant first, then still
-- offers the Google destination. A tap here is a record the restaurant gets
-- to keep -- never a gate on the Google link, which every paid guest still
-- sees (the fairness rule from 20261124040000 is unchanged).
--
-- SECURITY MODEL
--   * Guests hold no database role of their own; they authenticate a request
--     with the order's `guest_token` (the uuid embedded in their link).
--     Writes go through the SECURITY DEFINER RPC
--     `submit_order_review(p_guest_token, p_order_id, p_rating, p_note)`,
--     which matches the token against the order itself. There is no anon
--     policy on `order_reviews` at all -- the table is opaque to anon, and a
--     guessed order id without its token writes nothing.
--   * One review per order: resubmitting replaces the guest's own words
--     (upsert), it never stacks rows.
--   * Staff and owners read through the authenticated role, scoped by the
--     membership table the way every other staff read policy here is.

create table if not exists public.order_reviews (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  rating        integer not null check (rating between 1 and 5),
  note          text,
  created_at    timestamptz not null default now()
);

-- One review per order.
create unique index if not exists order_reviews_order_id_unique
  on public.order_reviews (order_id);

-- Owner dashboards read newest-first for one restaurant.
create index if not exists order_reviews_restaurant_created_idx
  on public.order_reviews (restaurant_id, created_at desc);

alter table public.order_reviews enable row level security;

-- Staff/owner reads, scoped to restaurants the reader is a member of. No
-- anon policy exists: guests never query this table directly, they only
-- receive their own submission echoed back by the RPC.
create policy order_reviews_select_staff
  on public.order_reviews
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.memberships m
       where m.user_id = auth.uid()
         and m.restaurant_id = order_reviews.restaurant_id
    )
  );

-- The submit RPC. SECURITY DEFINER because the writer is an anonymous guest
-- carrying only a token; the definer body is the token check itself.
--
-- Note is trimmed and capped (500 chars, like the Google URL column); an
-- empty note is stored as null. Re-running a submit updates the guest's own
-- review and re-dates it.
create or replace function public.submit_order_review(
  p_guest_token uuid,
  p_order_id    uuid,
  p_rating      integer,
  p_note        text default null
)
returns table (ok boolean, error text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_note          text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return query select false, 'Rating must be between 1 and 5.';
    return;
  end if;

  if p_guest_token is null or p_order_id is null then
    return query select false, 'This review link is not valid.';
    return;
  end if;

  select o.restaurant_id into v_restaurant_id
    from public.orders o
   where o.id = p_order_id
     and o.guest_token = p_guest_token
   limit 1;

  if v_restaurant_id is null then
    return query select false, 'This review link is not valid.';
    return;
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    v_note := left(v_note, 500);
  end if;

  insert into public.order_reviews (order_id, restaurant_id, rating, note)
  values (p_order_id, v_restaurant_id, p_rating, v_note)
  on conflict (order_id) do update
    set rating = excluded.rating,
        note   = excluded.note,
        created_at = now();

  return query select true, null::text;
end;
$$;

revoke all on function public.submit_order_review(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.submit_order_review(uuid, uuid, integer, text)
  to anon, authenticated, service_role;

comment on function public.submit_order_review(uuid, uuid, integer, text) is
  'Guest writes the in-app review for THEIR order: the guest_token must match the order row. Upserts one row per order; note capped at 500 chars.';
