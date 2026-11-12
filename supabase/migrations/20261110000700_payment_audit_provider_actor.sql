-- Provider activity has no human actor. The source audit schema already
-- models actor_id as nullable with a profiles FK; one deployed schema drifted
-- to NOT NULL and omitted that FK, causing the transactional settlement RPC to
-- roll back after updating the payment/order. Align the catalog with the
-- existing identity convention rather than fabricating a service-user UUID.
alter table public.payment_audit_events
  alter column actor_id drop not null;

do $$
declare
  v_actor_attnum smallint;
  v_profile_id_attnum smallint;
  v_name_taken boolean;
  v_fk_name name;
begin
  select a.attnum into v_actor_attnum
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.payment_audit_events'::regclass
     and a.attname = 'actor_id'
     and a.attnum > 0
     and not a.attisdropped;

  select a.attnum into v_profile_id_attnum
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.profiles'::regclass
     and a.attname = 'id'
     and a.attnum > 0
     and not a.attisdropped;

  if v_actor_attnum is null or v_profile_id_attnum is null then
    raise exception 'Expected payment_audit_events.actor_id and profiles.id before installing the actor FK.';
  end if;

  select c.conname into v_fk_name
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.payment_audit_events'::regclass
     and c.contype = 'f'
     and c.conkey = array[v_actor_attnum]
     and c.confrelid = 'public.profiles'::regclass
     and c.confkey = array[v_profile_id_attnum]
     and c.confdeltype = 'n'
   order by c.conname
   limit 1;

  select exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.payment_audit_events'::regclass
       and c.conname = 'payment_audit_events_actor_id_fkey'
  ) into v_name_taken;

  if v_fk_name is null and v_name_taken then
    raise exception 'payment_audit_events_actor_id_fkey exists with a different definition; refusing to replace it automatically.';
  end if;

  if v_fk_name is null then
    execute 'alter table public.payment_audit_events
      add constraint payment_audit_events_actor_id_fkey
      foreign key (actor_id) references public.profiles(id)
      on delete set null not valid';
    v_fk_name := 'payment_audit_events_actor_id_fkey';
  end if;

  -- Validate historical human IDs as well as enforcing the FK for new events.
  -- Existing rows that violate the identity convention fail closed.
  execute format(
    'alter table public.payment_audit_events validate constraint %I',
    v_fk_name
  );
end;
$$;
