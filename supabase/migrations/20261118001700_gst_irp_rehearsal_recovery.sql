-- Private local generation rehearsal only. This is not provider integration,
-- lease ownership for live work, cancellation storage or artifact promotion.
-- Read outstanding state on a new connection without the original worker or
-- wire payload. Payloads and unrelated outlet identities stay out of this read.
create or replace function public.load_gst_irp_rehearsal(p_outlet uuid,p_job uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('jobId',j.id,'documentKey',j.document_key,'environment',j.environment,
    'providerId',j.provider_id,'payloadSha256',j.request_sha256,'state',j.status,'revision',j.revision,
    'updatedAt',to_char(j.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    || coalesce(j.response_snapshot,'{}')
  from public.restaurant_irp_jobs j where j.outlet_id=p_outlet and j.id=p_job and j.environment='provider_test';
$$;
revoke all on function public.load_gst_irp_rehearsal(uuid,uuid) from public, anon, authenticated, service_role;

-- Pair sanitized evidence with its actual transition class. An application
-- clock alone cannot abandon a still-live dispatch: require durable DB age
-- at the revision-checked update. Only lookup-confirmed absence may retry
-- after a dispatch was uncertain. No signed data or verified state permitted.
create or replace function public.cas_gst_irp_rehearsal(
  p_job uuid,p_outlet uuid,p_key text,p_provider text,p_hash text,p_revision integer,p_state text,p_next text,p_meta jsonb
) returns boolean language plpgsql set search_path = public, pg_temp as $$
declare
  v_op text := p_meta->>'operation';
  v_issue text := p_meta->>'issue';
  v_result text := p_meta->>'result';
  v_digest text := p_meta->>'responseSha256';
  v_held boolean;
  v_job public.restaurant_irp_jobs%rowtype;
begin
  if jsonb_typeof(p_meta) is distinct from 'object' or p_meta - array['operation','issue','responseSha256','result'] <> '{}'::jsonb
      or v_op is distinct from 'generate'
      or (v_issue is not null and v_issue not in ('abandoned_dispatch','provider_duplicate','transport_uncertain','provider_rejected',
        'confirmed_not_dispatched','unverified_response','provider_confirmed_absent','lookup_indeterminate','unverified_lookup'))
      or (v_digest is not null and v_digest !~ '^[a-f0-9]{64}$')
      or coalesce(p_meta->>'result','') not in ('dispatch','outcome','lookup','abandoned')
      or not coalesce(case
        when p_next='dispatching' then p_state in ('prepared','retryable') and v_result='dispatch'
          and v_issue is null and v_digest is null
        when p_state='dispatching' and p_next='reconcile' then
          (v_result='outcome' and v_issue in ('provider_duplicate','transport_uncertain','unverified_response'))
          or (v_result='abandoned' and v_issue='abandoned_dispatch' and v_digest is null)
        when p_state='dispatching' and p_next='retryable' then v_result='outcome' and v_issue='confirmed_not_dispatched'
        when p_state='dispatching' and p_next='rejected' then v_result='outcome' and v_issue='provider_rejected'
        when p_state='reconcile' and p_next='retryable' then v_result='lookup' and v_issue='provider_confirmed_absent'
        when p_state='reconcile' and p_next='reconcile' then v_result='lookup' and v_issue in ('lookup_indeterminate','unverified_lookup')
        else false end,false) then
    raise exception 'Rehearsal persists only generation control states and sanitized evidence, not IRN, ACK or QR.' using errcode = '23514';
  end if;
  select * into v_job from public.restaurant_irp_jobs j where j.id=p_job and j.outlet_id=p_outlet
    and j.environment='provider_test' and j.provider_id=p_provider and j.document_key=p_key
    and j.request_sha256=p_hash and j.status=p_state and j.revision=p_revision;
  if not found then return false; end if;
  -- Serialize dispatch claims with the source-row update used by a local
  -- void. A claim following a committed void is refused.
  if p_next='dispatching' then
    if v_job.invoice_id is not null then
      select i.status='issued' and i.irp_status in ('pending','failed') into v_held
        from public.restaurant_invoices i where i.id=v_job.invoice_id and i.restaurant_id=p_outlet for share;
    else
      select n.status='issued' and n.irp_status in ('pending','failed') into v_held
        from public.restaurant_notes n where n.id=v_job.note_id and n.restaurant_id=p_outlet for share;
    end if;
    if v_held is distinct from true then return false; end if;
  end if;
  update public.restaurant_irp_jobs set status=p_next,revision=revision+1,response_snapshot=p_meta,updated_at=clock_timestamp()
    where id=v_job.id and revision=p_revision and status=p_state
      and (v_result <> 'abandoned' or updated_at <= clock_timestamp() - interval '120 seconds');
  if not found then return false; end if;
  insert into public.restaurant_irp_job_events(job_id,revision,state,operation,response)
    values(v_job.id,p_revision+1,p_next,v_op,p_meta);
  return true;
end;
$$;
