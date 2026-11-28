-- hit_rate_limit() only counts up, so the sign-in brake charged successful
-- sign-ins exactly like guesses. A whole shift signing in behind one office
-- line -- or the database-flow suite signing the seeded owner in test after
-- test from 127.0.0.1 -- spent the allowance by doing nothing wrong, and then
-- the next legitimate person was refused.
--
-- A successful sign-in hands its one attempt back. Only failures accumulate,
-- which is what a brute-force brake is supposed to measure.

create or replace function public.release_rate_limit_hit(p_key text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.rate_limit_hits
     set count = greatest(count - 1, 0)
   where key = p_key;
$$;

revoke all on function public.release_rate_limit_hit(text) from anon;
revoke all on function public.release_rate_limit_hit(text) from authenticated;
grant execute on function public.release_rate_limit_hit(text) to service_role;
