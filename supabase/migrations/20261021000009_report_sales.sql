-- 0009 · Sales reporting
--
-- WHY THIS IS A FUNCTION AND NOT A QUERY IN THE APP
--
-- A 30-day report at a busy venue is thousands of orders and tens of
-- thousands of lines. PostgREST has no joins, so the application would have to
-- fetch the orders first and then chunk every order id into `.in()` lists for
-- order_items and payments -- tens of round trips per page load, each one
-- capped by URL length, and the numbers would silently truncate the moment a
-- list got too long. Aggregating in the database is one round trip, integer
-- arithmetic throughout, and there is no row limit to quietly lose money from.
--
-- TWO DEFINITIONS THAT MUST NOT BE MIXED UP
--
--   billed     sum of order totals. What the restaurant sold.
--   collected  sum of payments actually recorded. What it was paid.
--
-- They are different numbers whenever a table has not settled yet, which in a
-- QR-ordering restaurant is most of the evening. Reporting one as the other is
-- the single easiest way to tell an owner their best day ever on a day they
-- have not been paid for.
--
-- CANCELLED ORDERS
--
-- Excluded from billed, from tax and from every item ranking. A cancelled
-- bill is not a sale and its dishes were not cooked. It is returned only as a
-- count, because a rising cancel count is worth seeing.
--
-- REPEATABLE CALLS
--
-- `stable`, not `volatile`: it only reads, so Postgres may inline it within a
-- statement. No writes, no side effects, no audit row.

create or replace function public.report_sales(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz,
  p_timezone      text    default 'Asia/Kolkata',
  p_bucket        text    default 'day',
  p_order_limit   integer default 200,
  p_include_lines boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz      text;
  v_limit   integer;
  v_result  jsonb;
begin
  -- Under SECURITY DEFINER, RLS is suspended inside the body, so this check is
  -- the tenant boundary. Without it any signed-in user could read any
  -- restaurant's takings by guessing a UUID.
  if not public.is_member(p_restaurant_id) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'The report range is not valid.' using errcode = '22023';
  end if;

  if p_bucket not in ('hour', 'day') then
    raise exception 'Bucket must be hour or day.' using errcode = '22023';
  end if;

  -- A range long enough to hide a mistake in the date picker is worth
  -- refusing rather than timing out on. One year is plenty.
  if p_to - p_from > interval '400 days' then
    raise exception 'Reports cover at most 400 days.' using errcode = '22023';
  end if;

  -- An unknown zone would make `at time zone` raise mid-report. Fall back to
  -- UTC rather than fail the whole screen over a bad restaurants.timezone row.
  v_tz := coalesce(nullif(p_timezone, ''), 'UTC');
  if not exists (select 1 from pg_timezone_names n where n.name = v_tz) then
    v_tz := 'UTC';
  end if;

  v_limit := greatest(coalesce(p_order_limit, 200), 0);

  with scoped as (
    select o.*
      from public.orders o
     where o.restaurant_id = p_restaurant_id
       and o.placed_at >= p_from
       and o.placed_at <  p_to
  ),
  -- Bills that count as sales.
  live as (
    select * from scoped where prep_status <> 'cancelled'
  ),
  paid as (
    select p.order_id,
           coalesce(sum(p.amount_paise) filter (where p.status = 'recorded'), 0) as recorded,
           coalesce(sum(p.amount_paise) filter (where p.status = 'refunded'), 0) as refunded
      from public.payments p
      join scoped s on s.id = p.order_id
     group by p.order_id
  ),
  lines as (
    select oi.name_snapshot,
           oi.variant_snapshot,
           oi.qty,
           oi.unit_price_paise,
           oi.item_id,
           sc.id            as order_id,
           sc.code,
           sc.placed_at,
           sc.prep_status
      from public.order_items oi
      join scoped sc on sc.id = oi.order_id
  ),
  totals as (
    select
      (select count(*)::int from live)                                          as bills,
      (select count(*)::int from scoped where prep_status = 'cancelled')         as cancelled,
      (select coalesce(sum(total_paise), 0)    from live)                        as billed,
      (select coalesce(sum(tax_paise), 0)      from live)                        as tax,
      (select coalesce(sum(discount_paise), 0) from live)                        as discount,
      (select coalesce(sum(recorded), 0)       from paid)                        as collected,
      (select coalesce(sum(refunded), 0)       from paid)                        as refunded,
      (select coalesce(sum(greatest(l.total_paise - coalesce(pd.recorded, 0), 0)), 0)
         from live l
         left join paid pd on pd.order_id = l.id)                                as unpaid
  ),
  bucket_rows as (
    select date_trunc(p_bucket, l.placed_at at time zone v_tz) as bucket,
           count(*)::int                        as bills,
           coalesce(sum(l.total_paise), 0)      as revenue
      from live l
     group by 1
  ),
  item_rows as (
    select case
             when l.variant_snapshot is null or l.variant_snapshot = ''
               then l.name_snapshot
             else l.name_snapshot || ' · ' || l.variant_snapshot
           end                                            as name,
           sum(l.qty)::int                                as qty,
           sum(l.qty * l.unit_price_paise)                as revenue
      from lines l
     where l.prep_status <> 'cancelled'
     group by 1
  ),
  category_rows as (
    select coalesce(c.name, 'Uncategorised')              as name,
           sum(l.qty)::int                                as qty,
           sum(l.qty * l.unit_price_paise)                as revenue
      from lines l
      left join public.items i      on i.id = l.item_id
      left join public.categories c on c.id = i.category_id
     where l.prep_status <> 'cancelled'
     group by 1
  ),
  method_rows as (
    select p.method,
           count(*)::int                                                    as payment_count,
           coalesce(sum(p.amount_paise) filter (where p.status = 'recorded'), 0) as recorded,
           coalesce(sum(p.amount_paise) filter (where p.status = 'refunded'), 0) as refunded
      from public.payments p
      join scoped s on s.id = p.order_id
     where p.status in ('recorded', 'refunded')
     group by p.method
  ),
  order_rows as (
    select o.id,
           o.code,
           o.placed_at,
           o.prep_status,
           o.payment_status,
           o.total_paise,
           o.tax_paise,
           o.subtotal_paise,
           o.discount_paise,
           coalesce(pd.recorded, 0) as paid_paise,
           coalesce(pd.refunded, 0) as refunded_paise,
           t.label                  as table_label
      from scoped o
      left join paid pd                 on pd.order_id = o.id
      left join public.dining_tables t  on t.id = o.table_id
     order by o.placed_at desc
     limit v_limit
  ),
  line_rows as (
    select l.code,
           l.placed_at,
           l.name_snapshot,
           l.variant_snapshot,
           l.qty,
           l.unit_price_paise
      from lines l
     where l.prep_status <> 'cancelled'
     order by l.placed_at, l.code
     limit 20000
  )
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'bucket', p_bucket,
    'timezone', v_tz,
    'totals', (
      select jsonb_build_object(
        'bills',          t.bills,
        'cancelled',      t.cancelled,
        'billed_paise',   t.billed,
        'tax_paise',      t.tax,
        'discount_paise', t.discount,
        'collected_paise', t.collected,
        'refunded_paise',  t.refunded,
        'unpaid_paise',    t.unpaid,
        -- Rounded to whole paise. `sum()` returns numeric, so an unrounded
        -- division hands back 200147.666666666667 -- a money figure with
        -- fifteen decimal places that the formatter cannot render honestly.
        'average_bill_paise',
          case when t.bills > 0 then round(t.billed / t.bills)::bigint else 0 end
      )
      from totals t
    ),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', to_char(b.bucket, 'YYYY-MM-DD HH24:MI'),
               'bills', b.bills,
               'revenue_paise', b.revenue
             ) order by b.bucket)
        from bucket_rows b
    ), '[]'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', r.name,
               'qty', r.qty,
               'revenue_paise', r.revenue
             ) order by r.revenue desc, r.name)
        from (select * from item_rows order by revenue desc, name limit 20) r
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', r.name,
               'qty', r.qty,
               'revenue_paise', r.revenue
             ) order by r.revenue desc, r.name)
        from category_rows r
    ), '[]'::jsonb),
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method', r.method,
               'count', r.payment_count,
               'recorded_paise', r.recorded,
               'refunded_paise', r.refunded
             ) order by r.method)
        from method_rows r
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'code', r.code,
               'placed_at', r.placed_at,
               'prep_status', r.prep_status,
               'payment_status', r.payment_status,
               'subtotal_paise', r.subtotal_paise,
               'discount_paise', r.discount_paise,
               'tax_paise', r.tax_paise,
               'total_paise', r.total_paise,
               'paid_paise', r.paid_paise,
               'refunded_paise', r.refunded_paise,
               'table_label', r.table_label
             ) order by r.placed_at desc)
        from order_rows r
    ), '[]'::jsonb),
    'lines', case when p_include_lines then coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code,
               'placed_at', r.placed_at,
               'name', r.name_snapshot,
               'variant', r.variant_snapshot,
               'qty', r.qty,
               'unit_price_paise', r.unit_price_paise
             ) order by r.placed_at, r.code)
        from line_rows r
    ), '[]'::jsonb) else '[]'::jsonb end
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.report_sales(uuid, timestamptz, timestamptz, text, text, integer, boolean) is
  'Aggregated sales for one restaurant and one time range. Members only. Billed and collected are reported separately on purpose.';

-- Signed-in staff only. A guest has no business reading takings, and anon
-- calling this with a guessed restaurant id would only get the 42501 above.
revoke all on function public.report_sales(uuid, timestamptz, timestamptz, text, text, integer, boolean)
  from public, anon;
grant execute on function public.report_sales(uuid, timestamptz, timestamptz, text, text, integer, boolean)
  to authenticated;
