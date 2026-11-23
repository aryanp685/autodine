-- New outlets must not inherit an invented tax rate.
--
-- The original schema defaulted tax_rate_bps to the 5% sample used by the
-- guest preview. That made a new restaurant collect a rate its owner never
-- chose, while the settings screen said AutoDine does not infer a rate. Owner
-- decision (2026-11-19): new outlets start at 0% until the owner sets a rate.
-- Existing rows keep their stored rate; this changes the default only.

alter table public.restaurants
  alter column tax_rate_bps set default 0;

comment on column public.restaurants.tax_rate_bps is
  'Owner-configured per-order rate in basis points. New restaurants start at 0%; the guest cart and the order RPC both read this value in GST-off mode.';
