-- Fixed shared budgets. The browser cannot choose a higher quota or name a
-- user; identity comes from the verified JWT and membership is checked here.
create or replace function public.reserve_staff_tts_attempt(p_restaurant_id uuid)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare u uuid := auth.uid(); a record; b record;
begin
  if u is null or not exists (select 1 from public.memberships m where m.restaurant_id=p_restaurant_id and m.user_id=u) then
    raise exception 'Staff membership required' using errcode='42501';
  end if;
  select * into a from public.hit_rate_limit('tts:u:'||u::text,30,600);
  if not a.allowed then return query select false,a.retry_after_seconds; return; end if;
  select * into b from public.hit_rate_limit('tts:r:'||p_restaurant_id::text,300,600);
  return query select b.allowed,b.retry_after_seconds;
end $$;
revoke all on function public.reserve_staff_tts_attempt(uuid) from public, anon;
grant execute on function public.reserve_staff_tts_attempt(uuid) to authenticated;
