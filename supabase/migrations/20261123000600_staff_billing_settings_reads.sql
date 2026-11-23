begin;

grant select (
  fssai_number,
  bill_footer_note,
  default_service_charge_bps,
  default_packaging_charge_paise,
  default_delivery_charge_paise,
  round_off_enabled
) on public.restaurants to authenticated;

commit;
