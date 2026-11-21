-- No public RPC may have two overloads.
--
-- A second overload of an RPC that the app calls with positional arguments makes
-- PostgreSQL unable to resolve `unknown`-typed parameters and the call fails at
-- runtime with "function ... is not unique" instead of a type error. That is
-- exactly what main's CI hit on 2026-11-21 for record_counter_payment (a 6-arg
-- variant added beside the 5-arg one). Running this check in every replay makes
-- the same regression impossible to merge unnoticed.
--
-- has_restaurant_role is exempt: it predates this rule and carries a text[] and a
-- member_role[] variant on some deployments.
do $$
declare
  r record;
begin
  for r in
    select p.proname,
           count(*) as overloads,
           string_agg(pg_get_function_identity_arguments(p.oid), ' | ' order by pg_get_function_identity_arguments(p.oid)) as signatures
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname <> 'has_restaurant_role'
     group by p.proname
    having count(*) > 1
  loop
    raise exception 'ambiguous RPC: public.% has % overloads (%)', r.proname, r.overloads, r.signatures;
  end loop;
end;
$$;
