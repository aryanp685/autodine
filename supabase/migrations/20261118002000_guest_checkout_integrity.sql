-- Guest checkout only. Preserve the existing RPC, admission, one-open-sitting
-- constraint, and GST/discount/pricing core. Roll back if the core could not
-- write the whole requested basket. An old attempt may be replayed only at
-- the same live table, including after that guest re-verifies there.
create or replace function public.place_public_order_attempt(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null,
  p_guest_token uuid default null,
  p_ip_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_table uuid;
  v_order uuid;
  v_prior_restaurant uuid;
  v_prior_table uuid;
  v_code text;
  v_error text;
  v_state text;
  v_hint text;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  select s.restaurant_id, s.table_id into v_restaurant, v_table
    from public.current_table_session(p_session_token) s
   where s.restaurant_slug = btrim(coalesce(p_slug, ''));

  if v_restaurant is null then
    return jsonb_build_object('code', null, 'error', jsonb_build_object(
      'code', 'P0001', 'message', 'Scan your table QR code again before ordering.', 'hint', 'table-session'));
  end if;
  if p_guest_token is null then
    return jsonb_build_object('code', null, 'error', jsonb_build_object(
      'code', 'P0001', 'message', 'Reopen checkout to start a new order attempt.', 'hint', ''));
  end if;

  perform pg_advisory_xact_lock(hashtext('guest:' || p_guest_token::text));
  select o.code, o.restaurant_id, o.table_id into v_code, v_prior_restaurant, v_prior_table
    from public.orders o where o.guest_token = p_guest_token;
  if found then
    if v_prior_restaurant = v_restaurant and v_prior_table = v_table then
      return jsonb_build_object('code', v_code, 'error', null);
    end if;
    return jsonb_build_object('code', null, 'error', jsonb_build_object(
      'code', 'P0001', 'message', 'This attempt could not be verified at this table. Check with staff before ordering again.', 'hint', 'attempt-mismatch'));
  end if;

  begin
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
      raise exception 'The order contained no items.' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) not between 1 and 100 then
      raise exception 'Choose between one and 100 lines before ordering.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_lines) as l(line)
       where jsonb_typeof(line) <> 'object'
          or coalesce(line->>'item_id', line->>'itemId', '') !~ v_uuid
          or coalesce(line->>'qty', '') !~ '^[1-9][0-9]?$'
          or (nullif(coalesce(line->>'variant_id', line->>'variantId'), '') is not null
              and coalesce(line->>'variant_id', line->>'variantId') !~ v_uuid)
          or jsonb_typeof(coalesce(line->'addon_ids', line->'addonIds', '[]'::jsonb)) <> 'array'
    ) then
      raise exception 'An item or quantity is invalid. Review your cart before ordering.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_lines) as l(line)
       where jsonb_array_length(coalesce(line->'addon_ids', line->'addonIds', '[]'::jsonb)) > 20
          or exists (select 1 from jsonb_array_elements_text(coalesce(line->'addon_ids', line->'addonIds', '[]'::jsonb)) as a(id)
                      where id is null or id !~ v_uuid)
    ) then
      raise exception 'An add-on is invalid. Review your cart before ordering.' using errcode = 'P0001';
    end if;

    v_code := public.place_public_order(p_slug, p_lines, p_note, p_session_token, p_guest_token, p_ip_hash);
    select o.id into strict v_order from public.orders o
     where o.restaurant_id = v_restaurant and o.table_id = v_table and o.guest_token = p_guest_token and o.code = v_code;

    -- Compare the actual saved rows (not a preflight SELECT that could race
    -- menu changes). A miss rolls back the ticket, lines and session together.
    if exists (
      select 1
        from jsonb_array_elements(p_lines) with ordinality as l(line, pos)
        left join public.order_items i on i.order_id = v_order and i.sort_order = l.pos
       where i.id is null
          or i.item_id is distinct from coalesce(line->>'item_id', line->>'itemId')::uuid
          or i.qty is distinct from (line->>'qty')::int
          or (nullif(coalesce(line->>'variant_id', line->>'variantId'), '') is not null and i.variant_snapshot is null)
          or coalesce(cardinality(i.addons_snapshot), 0) <> jsonb_array_length(coalesce(line->'addon_ids', line->'addonIds', '[]'::jsonb))
    ) then
      raise exception 'A dish, portion or add-on changed or is unavailable. Review your cart before placing it again.' using errcode = 'P0001';
    end if;
    return jsonb_build_object('code', v_code, 'error', null);
  exception when others then
    get stacked diagnostics v_error = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    -- Only fixed refusal text crosses the public API. A driver or extension
    -- error can otherwise put request or row data in MESSAGE_TEXT/DETAIL.
    v_hint := '';
    if v_state = 'P0001' and v_error in (
      'The order contained no items.',
      'Choose between one and 100 lines before ordering.',
      'An item or quantity is invalid. Review your cart before ordering.',
      'An add-on is invalid. Review your cart before ordering.',
      'None of those dishes are available right now.',
      'A dish, portion or add-on changed or is unavailable. Review your cart before placing it again.'
    ) then
      -- The same-key lookup ran under the advisory lock; no prior order
      -- existed and this call rolled back fully. The basket can be edited.
      v_hint := 'basket-refused';
    elsif v_state = 'P0001' and v_error in (
      'Your table verification has expired. Please ask staff for the current code.',
      'Your table verification is no longer valid. Please ask staff for the current code.',
      'This order is for a different restaurant. Please open the menu again.'
    ) then
      v_hint := 'table-session';
      v_error := 'Scan your table QR code again before ordering.';
    elsif v_state = 'P0001' and v_error in (
      'This outlet needs to review its GST settings before pricing new orders. Please ask staff.',
      'Billing settings changed while this order was being priced. Refresh and try again.',
      'This sitting already has tickets under a different GST configuration. Ask staff to finish it before adding more tickets.',
      'Alcoholic or unclassified items cannot be ordered under this outlet''s GST mode. Remove the item or ask staff.',
      'That restaurant is not taking orders right now.',
      'That restaurant has no published menu.'
    ) then
      v_hint := 'menu-refused';
    else
      v_error := 'The order could not be verified. Check with staff before placing it again.';
    end if;
    return jsonb_build_object('code', null, 'error', jsonb_build_object('code', v_state, 'message', v_error, 'hint', v_hint));
  end;
end;
$$;

comment on function public.place_public_order_attempt(text,jsonb,text,text,uuid,text) is
  'Unthrottled guest checkout: live-table admission, same-table replay, whole-basket commit using the existing server pricing core.';
