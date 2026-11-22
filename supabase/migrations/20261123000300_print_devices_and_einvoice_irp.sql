-- ============================================================================
-- Billing v2: Printing & Devices registry + Live e-Invoice IRP persistence
-- ============================================================================
-- 1. public.restaurant_printers: restaurant-scoped printer & device registry
--    (Counter Thermal 58/80mm, Office A4, Windows Bridge or Browser/OS Print).
-- 2. public.restaurant_invoices: add IRP acknowledgement columns (ack_no,
--    ack_date, signed_qr_payload, irp_provider, irp_generated_at,
--    irp_cancelled_at, irp_cancel_reason) and update immutability trigger so
--    ONLY audited SECURITY DEFINER IRP RPCs can record a live IRP result or
--    cancellation (never offline 'sandbox', never direct SQL/PostgREST updates).
-- 3. RPCs:
--    - upsert_restaurant_printer(...)
--    - delete_restaurant_printer(...)
--    - record_restaurant_printer_status(...)
--    - complete_restaurant_invoice_irp(...)
--    - cancel_restaurant_invoice_irp(...)

create table if not exists public.restaurant_printers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  role text not null default 'counter' check (role in ('counter', 'office', 'bar', 'other')),
  printer_type text not null default 'thermal' check (printer_type in ('thermal', 'a4')),
  connection_type text not null default 'windows_bridge' check (connection_type in ('windows_bridge', 'network_tcp', 'browser_os')),
  paper_width text not null default '80mm' check (paper_width in ('58mm', '80mm', 'a4')),
  bridge_printer_name text,
  network_host text,
  network_port integer check (network_port is null or network_port between 1 and 65535),
  is_default boolean not null default false,
  auto_print_on_close boolean not null default false,
  status text not null default 'untested' check (status in ('connected', 'offline', 'untested')),
  last_seen_at timestamptz,
  last_error text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint restaurant_printers_name_unique unique (restaurant_id, name)
);

create index if not exists restaurant_printers_lookup_idx
  on public.restaurant_printers (restaurant_id, is_default desc, created_at asc);

alter table public.restaurant_printers enable row level security;
revoke all on public.restaurant_printers from anon, authenticated, service_role;

drop policy if exists restaurant_printers_staff_read on public.restaurant_printers;
create policy restaurant_printers_staff_read on public.restaurant_printers
  for select to authenticated
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'cashier']));

grant select on table public.restaurant_printers to authenticated;

-- ======================================= Printer CRUD / status RPCs

create or replace function public.upsert_restaurant_printer(
  p_restaurant_id uuid,
  p_printer_id uuid default null,
  p_name text default null,
  p_role text default 'counter',
  p_printer_type text default 'thermal',
  p_connection_type text default 'windows_bridge',
  p_paper_width text default '80mm',
  p_bridge_printer_name text default null,
  p_network_host text default null,
  p_network_port integer default null,
  p_is_default boolean default false,
  p_auto_print_on_close boolean default false
) returns public.restaurant_printers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_role text := lower(btrim(coalesce(p_role, 'counter')));
  v_type text := lower(btrim(coalesce(p_printer_type, 'thermal')));
  v_conn text := lower(btrim(coalesce(p_connection_type, 'windows_bridge')));
  v_width text := lower(btrim(coalesce(p_paper_width, '80mm')));
  v_bridge_name text := nullif(btrim(coalesce(p_bridge_printer_name, '')), '');
  v_host text := nullif(btrim(coalesce(p_network_host, '')), '');
  v_port integer := p_network_port;
  v_row public.restaurant_printers%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in with an owner or manager account to manage printers.' using errcode = '42501';
  end if;
  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can configure printers.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(p_restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before updating devices.' using errcode = 'P0001';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'Printer name must be between 2 and 60 characters.' using errcode = '22023';
  end if;
  if v_role not in ('counter', 'office', 'bar', 'other') then
    raise exception 'Invalid printer role.' using errcode = '22023';
  end if;
  if v_type not in ('thermal', 'a4') then
    raise exception 'Invalid printer type.' using errcode = '22023';
  end if;
  if v_conn not in ('windows_bridge', 'network_tcp', 'browser_os') then
    raise exception 'Invalid printer connection type.' using errcode = '22023';
  end if;
  if v_width not in ('58mm', '80mm', 'a4') then
    raise exception 'Paper width must be 58mm, 80mm, or a4.' using errcode = '22023';
  end if;
  if v_conn = 'network_tcp' and v_host is null then
    raise exception 'Enter the LAN IP or hostname for a network printer.' using errcode = '22023';
  end if;
  if v_conn = 'network_tcp' and v_port is null then
    v_port := 9100;
  end if;

  if coalesce(p_is_default, false) then
    update public.restaurant_printers
       set is_default = false,
           updated_at = statement_timestamp()
     where restaurant_id = p_restaurant_id
       and printer_type = v_type
       and is_default = true
       and (p_printer_id is null or id <> p_printer_id);
  end if;

  if p_printer_id is not null then
    update public.restaurant_printers
       set name = v_name,
           role = v_role,
           printer_type = v_type,
           connection_type = v_conn,
           paper_width = v_width,
           bridge_printer_name = v_bridge_name,
           network_host = v_host,
           network_port = v_port,
           is_default = coalesce(p_is_default, false),
           auto_print_on_close = coalesce(p_auto_print_on_close, false),
           updated_at = statement_timestamp()
     where id = p_printer_id
       and restaurant_id = p_restaurant_id
    returning * into v_row;
    if not found then
      raise exception 'Printer not found for this restaurant.' using errcode = 'P0002';
    end if;
  else
    insert into public.restaurant_printers (
      restaurant_id, name, role, printer_type, connection_type, paper_width,
      bridge_printer_name, network_host, network_port, is_default, auto_print_on_close
    ) values (
      p_restaurant_id, v_name, v_role, v_type, v_conn, v_width,
      v_bridge_name, v_host, v_port, coalesce(p_is_default, false), coalesce(p_auto_print_on_close, false)
    )
    on conflict (restaurant_id, name) do update
      set role = excluded.role,
          printer_type = excluded.printer_type,
          connection_type = excluded.connection_type,
          paper_width = excluded.paper_width,
          bridge_printer_name = excluded.bridge_printer_name,
          network_host = excluded.network_host,
          network_port = excluded.network_port,
          is_default = excluded.is_default,
          auto_print_on_close = excluded.auto_print_on_close,
          updated_at = statement_timestamp()
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.upsert_restaurant_printer(uuid, uuid, text, text, text, text, text, text, text, integer, boolean, boolean) from public, anon, authenticated;
grant execute on function public.upsert_restaurant_printer(uuid, uuid, text, text, text, text, text, text, text, integer, boolean, boolean) to authenticated;

create or replace function public.delete_restaurant_printer(
  p_printer_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_printer public.restaurant_printers%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in with an owner or manager account to remove printers.' using errcode = '42501';
  end if;
  select * into v_printer from public.restaurant_printers where id = p_printer_id;
  if not found then
    raise exception 'Printer not found.' using errcode = 'P0002';
  end if;
  if not public.has_restaurant_role(v_printer.restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can remove printers.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_printer.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;

  delete from public.restaurant_printers where id = p_printer_id;
  return true;
end;
$$;

revoke all on function public.delete_restaurant_printer(uuid) from public, anon, authenticated;
grant execute on function public.delete_restaurant_printer(uuid) to authenticated;

create or replace function public.record_restaurant_printer_status(
  p_printer_id uuid,
  p_status text,
  p_error text default null
) returns public.restaurant_printers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_status text := lower(btrim(coalesce(p_status, 'untested')));
  v_printer public.restaurant_printers%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in to update printer status.' using errcode = '42501';
  end if;
  select * into v_printer from public.restaurant_printers where id = p_printer_id for update;
  if not found then
    raise exception 'Printer not found.' using errcode = 'P0002';
  end if;
  if not public.has_restaurant_role(v_printer.restaurant_id, array['owner', 'manager', 'cashier']) then
    raise exception 'You do not have permission to update printer status.' using errcode = '42501';
  end if;
  if v_status not in ('connected', 'offline', 'untested') then
    raise exception 'Invalid printer status.' using errcode = '22023';
  end if;

  update public.restaurant_printers
     set status = v_status,
         last_seen_at = case when v_status = 'connected' then statement_timestamp() else last_seen_at end,
         last_error = nullif(left(btrim(coalesce(p_error, '')), 300), ''),
         updated_at = statement_timestamp()
   where id = p_printer_id
  returning * into v_printer;

  return v_printer;
end;
$$;

revoke all on function public.record_restaurant_printer_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_restaurant_printer_status(uuid, text, text) to authenticated;

-- ======================================= e-Invoice IRP persistence columns + immutability guard

alter table public.restaurant_invoices
  add column if not exists ack_no text,
  add column if not exists ack_date timestamptz,
  add column if not exists signed_qr_payload text,
  add column if not exists irp_provider text,
  add column if not exists irp_generated_at timestamptz,
  add column if not exists irp_cancelled_at timestamptz,
  add column if not exists irp_cancel_reason text;

alter table public.restaurant_irp_requests drop constraint if exists restaurant_irp_requests_status_check;
alter table public.restaurant_irp_requests add constraint restaurant_irp_requests_status_check
  check (status in ('payload_built', 'submitted', 'accepted', 'rejected', 'transport_error', 'cancelled'));

create or replace function public.restaurant_invoices_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_void_unchanged boolean;
  v_irp_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Invoice records can never be deleted; void them instead.' using errcode = '42501';
  end if;

  if (to_jsonb(new) - 'status' - 'voided_at' - 'voided_by' - 'void_reason'
        - 'irn' - 'irp_status' - 'ack_no' - 'ack_date' - 'signed_qr_payload'
        - 'irp_provider' - 'irp_generated_at' - 'irp_cancelled_at' - 'irp_cancel_reason')
     is distinct from
     (to_jsonb(old) - 'status' - 'voided_at' - 'voided_by' - 'void_reason'
        - 'irn' - 'irp_status' - 'ack_no' - 'ack_date' - 'signed_qr_payload'
        - 'irp_provider' - 'irp_generated_at' - 'irp_cancelled_at' - 'irp_cancel_reason') then
    raise exception 'Issued invoices are immutable. Only the audited void or IRP registration transition is permitted.' using errcode = '42501';
  end if;

  v_irp_changed := (
    (new.irn, new.irp_status, new.ack_no, new.ack_date, new.signed_qr_payload,
     new.irp_provider, new.irp_generated_at, new.irp_cancelled_at, new.irp_cancel_reason)
    is distinct from
    (old.irn, old.irp_status, old.ack_no, old.ack_date, old.signed_qr_payload,
     old.irp_provider, old.irp_generated_at, old.irp_cancelled_at, old.irp_cancel_reason)
  );

  if v_irp_changed then
    if coalesce(current_setting('autodine.irp_write_context', true), '') <> 'rpc' then
      raise exception 'Issued invoices are immutable. IRP fields can only be updated through audited IRP RPCs.' using errcode = '42501';
    end if;
    if new.status <> 'issued' or old.status <> 'issued' then
      raise exception 'Cannot update IRP state on a voided invoice.' using errcode = '42501';
    end if;
    if old.irp_status in ('pending', 'failed') and new.irp_status in ('generated', 'failed') then
      if new.irp_status = 'generated' and (new.irn is null or new.irn !~ '^[0-9a-f]{64}$') then
        raise exception 'A valid 64-character hex IRN is required to mark an invoice generated.' using errcode = '22023';
      end if;
    elsif old.irp_status = 'generated' and new.irp_status = 'cancelled' then
      if new.irp_cancelled_at is null or new.irp_cancel_reason is null then
        raise exception 'Cancelling an IRN requires a timestamp and reason.' using errcode = '22023';
      end if;
    else
      raise exception 'Invalid IRP status transition from % to %.', old.irp_status, new.irp_status using errcode = '42501';
    end if;
  end if;

  v_void_unchanged := (new.voided_at, new.voided_by, new.void_reason) is not distinct from (old.voided_at, old.voided_by, old.void_reason);
  if new.status = old.status then
    if not v_void_unchanged then
      raise exception 'Issued invoices are immutable; void fields cannot be edited in place.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'issued' and new.status = 'voided' then
    if new.voided_at is null or new.void_reason is null or char_length(btrim(new.void_reason)) < 5 then
      raise exception 'Voiding requires a timestamp and a reason of at least 5 characters.' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Invoice status can only move from issued to voided.' using errcode = '42501';
end;
$$;

revoke all on function public.restaurant_invoices_immutable() from public, anon, authenticated, service_role;

-- ======================================= Complete / Cancel IRP RPCs

create or replace function public.complete_restaurant_invoice_irp(
  p_invoice_id uuid,
  p_provider text,
  p_outcome text,
  p_irn text default null,
  p_ack_no text default null,
  p_ack_date timestamptz default null,
  p_signed_qr_payload text default null,
  p_request_sha256 text default null,
  p_response_sha256 text default null,
  p_error_code text default null,
  p_error_message text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_inv public.restaurant_invoices%rowtype;
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_attempt integer;
  v_audit_status text;
begin
  if v_actor is null then
    raise exception 'Sign in to record e-Invoice registration.' using errcode = '42501';
  end if;

  select * into v_inv from public.restaurant_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  if not public.has_restaurant_role(v_inv.restaurant_id, array['owner', 'manager', 'cashier']) then
    raise exception 'You do not have permission to update e-Invoice status for this restaurant.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_inv.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;
  if v_inv.status <> 'issued' or v_inv.document_type <> 'gst_tax_invoice' then
    raise exception 'Only issued Regular-GST tax invoices support IRP registration.' using errcode = 'P0001';
  end if;
  if v_inv.irp_status not in ('pending', 'failed') then
    raise exception 'Invoice IRP status is %, not pending or failed.', v_inv.irp_status using errcode = 'P0001';
  end if;
  if char_length(v_provider) < 2 then
    raise exception 'Provider identifier is required.' using errcode = '22023';
  end if;
  if v_outcome not in ('generated', 'failed', 'transport_error') then
    raise exception 'Invalid IRP outcome %.', v_outcome using errcode = '22023';
  end if;
  if v_outcome = 'generated' and v_provider = 'sandbox' then
    raise exception 'Offline sandbox cannot mark an invoice as legally IRN-generated.' using errcode = '42501';
  end if;

  if v_outcome = 'generated' then
    if coalesce(p_irn, '') !~ '^[0-9a-f]{64}$' then
      raise exception 'A valid 64-character hex IRN is required.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_signed_qr_payload, '')), '') is null then
      raise exception 'Signed QR payload from IRP is required.' using errcode = '22023';
    end if;
    perform set_config('autodine.irp_write_context', 'rpc', true);
    update public.restaurant_invoices
       set irp_status = 'generated',
           irn = p_irn,
           ack_no = nullif(btrim(coalesce(p_ack_no, '')), ''),
           ack_date = coalesce(p_ack_date, statement_timestamp()),
           signed_qr_payload = btrim(p_signed_qr_payload),
           irp_provider = v_provider,
           irp_generated_at = coalesce(p_ack_date, statement_timestamp())
     where id = v_inv.id;
    v_audit_status := 'accepted';
  else
    perform set_config('autodine.irp_write_context', 'rpc', true);
    update public.restaurant_invoices
       set irp_status = 'failed',
           irp_provider = v_provider
     where id = v_inv.id;
    v_audit_status := case when v_outcome = 'transport_error' then 'transport_error' else 'rejected' end;
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_attempt
    from public.restaurant_irp_requests
   where invoice_id = v_inv.id;

  insert into public.restaurant_irp_requests (
    restaurant_id, invoice_id, attempt_no, provider, payload_version, status,
    request_sha256, response_sha256, error_code, error_message
  ) values (
    v_inv.restaurant_id, v_inv.id, v_attempt, v_provider, 'autodine.irp.v1', v_audit_status,
    p_request_sha256, p_response_sha256, p_error_code, p_error_message
  );

  return jsonb_build_object(
    'invoice_id', v_inv.id,
    'irp_status', case when v_outcome = 'generated' then 'generated' else 'failed' end,
    'irn', case when v_outcome = 'generated' then p_irn else null end
  );
end;
$$;

revoke all on function public.complete_restaurant_invoice_irp(uuid, text, text, text, text, timestamptz, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_restaurant_invoice_irp(uuid, text, text, text, text, timestamptz, text, text, text, text, text) to authenticated;

create or replace function public.cancel_restaurant_invoice_irp(
  p_invoice_id uuid,
  p_provider text,
  p_reason_code text,
  p_remark text,
  p_cancelled_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_inv public.restaurant_invoices%rowtype;
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_reason text := btrim(coalesce(p_reason_code, ''));
  v_remark text := btrim(coalesce(p_remark, ''));
  v_cancelled_at timestamptz := coalesce(p_cancelled_at, statement_timestamp());
  v_attempt integer;
begin
  if v_actor is null then
    raise exception 'Sign in with an owner or manager account to cancel an IRN.' using errcode = '42501';
  end if;

  select * into v_inv from public.restaurant_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  if not public.has_restaurant_role(v_inv.restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can cancel an e-Invoice IRN.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_inv.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;
  if v_inv.irp_status <> 'generated' or v_inv.irn is null then
    raise exception 'Only an invoice with a generated IRN can be cancelled on IRP.' using errcode = 'P0001';
  end if;
  if v_reason not in ('1', '2', '3', '4') then
    raise exception 'IRP cancel reason code must be 1 (Duplicate), 2 (Data entry mistake), 3 (Order cancelled), or 4 (Others).' using errcode = '22023';
  end if;
  if char_length(v_remark) < 3 or char_length(v_remark) > 100 then
    raise exception 'Cancel remark must be between 3 and 100 characters.' using errcode = '22023';
  end if;
  if statement_timestamp() - coalesce(v_inv.irp_generated_at, v_inv.issued_at) > interval '24 hours' then
    raise exception 'The 24-hour IRP IRN cancellation window has closed; issue a Credit Note instead.' using errcode = 'P0001';
  end if;

  perform set_config('autodine.irp_write_context', 'rpc', true);
  update public.restaurant_invoices
     set irp_status = 'cancelled',
         irp_cancelled_at = v_cancelled_at,
         irp_cancel_reason = v_reason || ': ' || v_remark
   where id = v_inv.id;

  select coalesce(max(attempt_no), 0) + 1 into v_attempt
    from public.restaurant_irp_requests
   where invoice_id = v_inv.id;

  insert into public.restaurant_irp_requests (
    restaurant_id, invoice_id, attempt_no, provider, payload_version, status, error_message
  ) values (
    v_inv.restaurant_id, v_inv.id, v_attempt, coalesce(nullif(v_provider, ''), coalesce(v_inv.irp_provider, 'nic_gsp')),
    'autodine.irp.v1', 'cancelled', v_reason || ': ' || v_remark
  );

  return jsonb_build_object(
    'invoice_id', v_inv.id,
    'irp_status', 'cancelled',
    'irp_cancelled_at', v_cancelled_at
  );
end;
$$;

revoke all on function public.cancel_restaurant_invoice_irp(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cancel_restaurant_invoice_irp(uuid, text, text, text, timestamptz) to authenticated;
