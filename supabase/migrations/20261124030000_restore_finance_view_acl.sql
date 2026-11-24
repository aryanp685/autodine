begin;

revoke all on public.orders_finance from public, anon, authenticated;
grant select on public.orders_finance to authenticated, service_role;

commit;
