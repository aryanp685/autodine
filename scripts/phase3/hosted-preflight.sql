-- Read-only schema gate and aggregate connection snapshot; no tenant records.
-- Run only on the discovered/confirmed approved nonproduction project.
select
  current_setting('server_version') as server_version,
  to_regprocedure('public.place_public_order_attempt(text,jsonb,text,text,uuid,text)') is not null as attempt_api_exists,
  coalesce(has_function_privilege('anon',to_regprocedure('public.place_public_order_attempt(text,jsonb,text,text,uuid,text)'),'EXECUTE'),false) as attempt_api_anon,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.place_public_order_attempt(text,jsonb,text,text,uuid,text)'),'EXECUTE'),false) as attempt_api_authenticated,
  coalesce(has_function_privilege('anon',to_regprocedure('public.place_public_order(text,jsonb,text,text,uuid,text)'),'EXECUTE'),false) as legacy_api_anon,
  (select count(*) from pg_stat_activity where datname=current_database()) as connections,
  (select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock') as lock_waiters,
  (select count(*) from pg_stat_activity where datname=current_database() and state='idle in transaction') as idle_transactions;
