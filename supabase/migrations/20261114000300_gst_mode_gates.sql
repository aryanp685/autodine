-- GST mode gates: alcohol blocks Composition activation; off-mode
-- declaration capture; specified-premises effective dating (2026-11-14).
--
-- Why in the database: mode is saved through direct table upserts, so
-- table-level enforcement is the only way the rule cannot be bypassed by
-- the UI or by ad hoc SQL. The app action adds readable refusals; the
-- database is the authority.
--
-- Semantics:
--   1. A restaurant with at least one alcoholic item may not activate the
--      Composition Scheme (alcohol is not GST-taxable and the scheme's
--      ineligibility list includes alcoholic liquor).
--   2. Marking an item alcoholic is refused while the restaurant's live
--      GST mode is composition.
--   3. mode='off' records the owner's Normal-Billing declaration (off
--      means "we are not registered for GST or are not issuing GST
--      documents", never "we ignore our GST obligation").
--   4. The 18% specified-premises profile records its effective date
--      (defaults to the notification's 2025-04-01 start).
--
-- Everything forward-only; no existing rows are rewritten.

-- =================== 1 & 2: alcohol cannot straddle Composition

create or replace function public.reject_alcohol_straddle_composition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  -- Items gate: refuse to flag an item alcoholic under a live Composition config.
  if tg_table_name = 'items' then
    if coalesce(new.is_alcoholic, false) is distinct from coalesce(old.is_alcoholic, false)
       and coalesce(new.is_alcoholic, false) = true then
      select c.mode into v_mode from public.restaurant_gst_config c where c.restaurant_id = new.restaurant_id;
      if v_mode = 'composition' then
        raise exception 'This restaurant is on the Composition Scheme, which does not permit alcoholic liquor. Switch GST mode out of composition before marking this item alcoholic.'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  -- Config gate: refuse to activate composition while an alcoholic item exists.
  if tg_table_name = 'restaurant_gst_config' then
    if new.mode = 'composition' then
      if exists (
        select 1 from public.items i
         where i.restaurant_id = new.restaurant_id and i.is_alcoholic
      ) then
        raise exception 'This restaurant has alcoholic items on the menu. The Composition Scheme does not permit alcoholic liquor, so composition billing cannot be activated while they exist.'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists restaurant_gst_config_no_alcohol on public.restaurant_gst_config;
create trigger restaurant_gst_config_no_alcohol
  before insert or update of mode on public.restaurant_gst_config
  for each row execute function public.reject_alcohol_straddle_composition();

drop trigger if exists items_no_alcohol_under_composition on public.items;
create trigger items_no_alcohol_under_composition
  before insert or update of is_alcoholic on public.items
  for each row execute function public.reject_alcohol_straddle_composition();

-- =================== 3: Normal-Billing declaration capture

alter table public.restaurant_gst_config add column if not exists off_declared boolean not null default false;
alter table public.restaurant_gst_config add column if not exists off_declared_at timestamptz;

comment on column public.restaurant_gst_config.off_declared is
  'Owner assertion recorded when explicitly choosing Normal Billing: this restaurant is not issuing GST documents (not registered, or registered but documents are deliberately not GST tax invoices). Never a statement of non-liability.';
comment on column public.restaurant_gst_config.off_declared_at is
  'When the owner most recently confirmed the Normal-Billing declaration.';

-- ============ 4: specified-premises effective dating

alter table public.restaurant_gst_config
  add column if not exists specified_premises_effective_from date not null default '2025-04-01';

comment on column public.restaurant_gst_config.specified_premises_effective_from is
  'Effective date of the 18% specified-premises treatment (Notification No. 05/2025-CT(Rate), w.e.f. 2025-04-01). Part of the configuration snapshot lineage via config_version; documents issued under this profile are for supplies on/after this date.';
