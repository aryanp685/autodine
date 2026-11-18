-- ====================================================================
-- GST: e-Invoice issuance profile (2026-11-14)
-- ====================================================================
-- The e-Invoice (IRP) payload builder needs three outlet facts the GST
-- configuration did not carry:
--
--   einvoice_location  the city/district/taluka on the GST registration
--                      (NIC: seller Location). Not inferred from the
--                      free-text address block — that would guess.
--   einvoice_pincode   the 6-digit PIN of the registered outlet
--                      (NIC: seller Pincode).
--   einvoice_hsn_sac   the default HSN/SAC for this outlet's restaurant
--                      services (NIC: ItemList.HsnCd), e.g. 996331.
--
-- All three are NULL until the owner records them in Settings. The
-- e-invoice issuance service FAILS CLOSED without them: no payload is
-- built, nothing is recorded, and the owner is told exactly what to add.
-- Nothing here enables a provider; adapters are wired in the app layer
-- and the only existing adapter is the offline sandbox used by tests.
--
-- Forward-only. No hosted database is touched by this commit; verify on
-- an isolated non-production database first (the embedded harness does).

alter table public.restaurant_gst_config
  add column if not exists einvoice_location text,
  add column if not exists einvoice_pincode text,
  add column if not exists einvoice_hsn_sac text;

alter table public.restaurant_gst_config
  drop constraint if exists restaurant_gst_config_einvoice_location;
alter table public.restaurant_gst_config
  add constraint restaurant_gst_config_einvoice_location
  check (einvoice_location is null or char_length(btrim(einvoice_location)) between 2 and 120);

alter table public.restaurant_gst_config
  drop constraint if exists restaurant_gst_config_einvoice_pincode;
alter table public.restaurant_gst_config
  add constraint restaurant_gst_config_einvoice_pincode
  check (einvoice_pincode is null or einvoice_pincode ~ '^[1-9][0-9]{5}$');

alter table public.restaurant_gst_config
  drop constraint if exists restaurant_gst_config_einvoice_hsn_sac;
alter table public.restaurant_gst_config
  add constraint restaurant_gst_config_einvoice_hsn_sac
  check (einvoice_hsn_sac is null or einvoice_hsn_sac ~ '^[0-9]{4,8}$');

comment on column public.restaurant_gst_config.einvoice_location is
  'City/district/taluka on the GST registration (seller Location on IRP payloads). Recorded by the owner; never inferred.';
comment on column public.restaurant_gst_config.einvoice_pincode is
  'PIN code of the registered outlet (seller Pincode on IRP payloads). Indian PIN: 6 digits, first digit 1-9.';
comment on column public.restaurant_gst_config.einvoice_hsn_sac is
  'Default HSN/SAC for this outlet''s restaurant service line items (e.g. 996331). Used on IRP payloads; confirm with your GST adviser.';

-- History mirrors the live config byte-for-byte; keep them in step.
alter table public.restaurant_gst_config_history
  add column if not exists einvoice_location text,
  add column if not exists einvoice_pincode text,
  add column if not exists einvoice_hsn_sac text;

create or replace function public.restaurant_gst_config_history_track()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.restaurant_gst_config_history (
    restaurant_id, config_version, mode, regular_profile, gstin, legal_name,
    trade_name, address, state_code, pan, registration_type,
    composition_acknowledged, specified_premises_attested,
    preceding_fy_turnover_paise,
    einvoice_location, einvoice_pincode, einvoice_hsn_sac,
    changed_by
  ) values (
    new.restaurant_id, new.config_version, new.mode, new.regular_profile, new.gstin,
    new.legal_name, new.trade_name, new.address, new.state_code, new.pan,
    new.registration_type, new.composition_acknowledged, new.specified_premises_attested,
    new.preceding_fy_turnover_paise,
    new.einvoice_location, new.einvoice_pincode, new.einvoice_hsn_sac,
    auth.uid()
  );
  return new;
end;
$$;

revoke all on function public.restaurant_gst_config_history_track() from public, anon, authenticated, service_role;
