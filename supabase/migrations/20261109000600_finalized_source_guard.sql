-- Keep the issued receipt and its source ledger consistent. Cancellation or
-- repricing an unpaid order after checkout previously changed the live bill
-- without changing the already-issued immutable invoice.
create or replace function public.guard_finalized_order_source()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_session uuid;
begin
  if tg_table_name = 'orders' then
    v_session := old.order_session_id;
    if tg_op = 'UPDATE' and
       (new.restaurant_id, new.table_id, new.order_session_id, new.subtotal_paise,
        new.discount_paise, new.tax_paise, new.total_paise, new.code,
        new.prep_status = 'cancelled') is not distinct from
       (old.restaurant_id, old.table_id, old.order_session_id, old.subtotal_paise,
        old.discount_paise, old.tax_paise, old.total_paise, old.code,
        old.prep_status = 'cancelled') then
      return new;
    end if;
  else
    select order_session_id into v_session from public.orders where id = old.order_id;
  end if;
  if exists (select 1 from public.restaurant_invoices
             where order_session_id = v_session and status = 'issued') then
    raise exception 'This bill has a finalized invoice. Void it through the authorized correction workflow before changing its source.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_finalized_order_source() from public, anon, authenticated;
create trigger orders_guard_finalized_source before update or delete on public.orders
for each row execute function public.guard_finalized_order_source();
create trigger order_items_guard_finalized_source before update or delete on public.order_items
for each row execute function public.guard_finalized_order_source();
