-- ============================================================================
-- AutoDine — migration 20261024000900: remove the code-less way in
--
-- APPLY THIS ONLY AFTER the build that uses verify_table_qr_with_code is
-- live. It is the second half of 20261023000900_table_verification_code.sql,
-- split out for one reason: the application currently deployed on main calls
-- verify_table_qr() on every scan, so dropping it in the same migration that
-- introduces its replacement guarantees a window where scanning is broken --
-- either between migration and deploy, or between deploy and migration.
--
-- THE HOLE THIS CLOSES
--
-- verify_table_qr(token, ip) took a scanned card as sufficient proof and was
-- granted to anon. Anyone holding a photograph of a card could call it through
-- the Supabase REST API with the publishable key, ignoring the application
-- entirely, and receive an hour-long table session. No amount of checking
-- inside Next.js could have prevented that: the route was optional.
--
-- Its replacement checks the six digits showing inside the restaurant inside
-- the same transaction that mints the session, so there is nothing to skip.
--
-- WHAT IS DONE HERE
--
--   * revoke every grant, including service_role, so nothing can call it by
--     accident or by habit;
--   * drop the function, so it cannot be called at all.
--
-- Sessions already issued stay valid until they expire or their card is
-- revoked. Nothing else changes: staff counter orders go through
-- place_counter_order, which this migration does not touch.
--
-- CHECK BEFORE APPLYING
--
--   select proname from pg_proc
--    where proname = 'verify_table_qr_with_code'
--      and pronamespace = 'public'::regnamespace;
--
-- One row means the replacement exists and this migration is safe to run.
-- Zero rows means 20261023000900 has not been applied yet -- run that first.
-- ============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'verify_table_qr_with_code'
  ) then
    raise exception
      'verify_table_qr_with_code is missing: apply 20261023000900_table_verification_code.sql first.';
  end if;
end;
$$;

revoke all on function public.verify_table_qr(text, text) from public;
revoke all on function public.verify_table_qr(text, text) from anon;
revoke all on function public.verify_table_qr(text, text) from authenticated;
revoke all on function public.verify_table_qr(text, text) from service_role;

drop function if exists public.verify_table_qr(text, text);
