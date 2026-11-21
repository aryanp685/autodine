-- Run subscription expiry regularly in hosted projects that have pg_cron.
-- Staging and local PostgreSQL do not necessarily install pg_cron, so this
-- migration is intentionally a no-op where the extension is unavailable.
do $$
begin
  if exists (
    select 1
      from pg_catalog.pg_extension
     where extname = 'pg_cron'
  ) and to_regprocedure('cron.schedule(text,text,text)') is not null then
    execute $schedule$
      select cron.schedule(
        'autodine-subscription-expiry',
        '*/15 * * * *',
        'select public.expire_subscriptions();'
      )
    $schedule$;
  end if;
end
$$;
