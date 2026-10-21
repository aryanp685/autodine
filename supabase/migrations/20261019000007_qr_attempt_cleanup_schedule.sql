-- The application migration keeps the cleanup function independently testable.
-- Supabase Postgres deployments schedule it here. Local PGlite cannot run pg_cron;
-- the cleanup function is covered by the integration test in migration 0006.
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname = 'autodine-qr-attempt-retention'
      and database = current_database()
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'autodine-qr-attempt-retention',
    '*/15 * * * *',
    'select public.cleanup_expired_qr_verification_attempts();'
  );
end;
$$;
