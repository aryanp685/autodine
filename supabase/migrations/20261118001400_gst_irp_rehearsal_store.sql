-- Durable provider-independent rehearsal evidence. The SQL functions are
-- INVOKER and not executable by any Data API role (including service_role).
-- No trigger or worker updates irp_status, IRN, printed or shared outputs.
alter table public.restaurant_irp_jobs add column revision integer not null default 0 check (revision >= 0);
create table public.restaurant_irp_job_events (
  job_id uuid not null references public.restaurant_irp_jobs(id) on delete restrict,
  revision integer not null check (revision >= 0),
  state text not null,
  operation text check (operation in ('generate','cancel')),
  response jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (job_id,revision)
);
alter table public.restaurant_irp_job_events enable row level security;
revoke all on public.restaurant_irp_job_events from public, anon, authenticated, service_role;

create or replace function public.reserve_gst_irp_rehearsal(
  p_preflight uuid,p_outlet uuid,p_key text,p_provider text,p_request_hash text,p_payload jsonb
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_src public.restaurant_irp_jobs%rowtype;
  v_job public.restaurant_irp_jobs%rowtype;
  v_held boolean;
begin
  if p_provider is null or p_provider !~ '^rehearsal-[a-z0-9-]{1,24}$' or coalesce(p_request_hash,'') !~ '^[a-f0-9]{64}$' then
    raise exception 'Only a named synthetic adapter and a validated request can reserve a rehearsal.' using errcode = '23514';
  end if;
  select * into v_src from public.restaurant_irp_jobs j where j.id=p_preflight and j.outlet_id=p_outlet
    and j.environment='offline' and j.status='prepared_offline' and j.document_key=p_key and j.request_payload=p_payload;
  if not found then raise exception 'No matching immutable offline request in this outlet.' using errcode = '23514'; end if;
  if v_src.invoice_id is not null then
    select i.status='issued' and i.irp_status in ('pending','failed') into v_held
      from public.restaurant_invoices i where i.id=v_src.invoice_id and i.restaurant_id=p_outlet for share;
  else
    select n.status='issued' and n.irp_status in ('pending','failed') into v_held
      from public.restaurant_notes n where n.id=v_src.note_id and n.restaurant_id=p_outlet for share;
  end if;
  if v_held is distinct from true then raise exception 'The source is no longer an IRN-held document.' using errcode = '23514'; end if;
  insert into public.restaurant_irp_jobs(outlet_id,invoice_id,note_id,environment,document_key,canonical_sha256,
    request_sha256,payload_version,request_payload,status,provider_id,requested_by)
  values (p_outlet,v_src.invoice_id,v_src.note_id,'provider_test',p_key,v_src.canonical_sha256,
    p_request_hash,v_src.payload_version,v_src.request_payload,'prepared',p_provider,v_src.requested_by)
  on conflict (environment,document_key) do nothing returning * into v_job;
  if found then
    insert into public.restaurant_irp_job_events(job_id,revision,state,response) values(v_job.id,0,'prepared','{}');
  else
    select * into strict v_job from public.restaurant_irp_jobs j where j.environment='provider_test' and j.document_key=p_key;
    if (v_job.outlet_id,v_job.invoice_id,v_job.note_id,v_job.provider_id,v_job.request_sha256,v_job.request_payload)
       is distinct from (p_outlet,v_src.invoice_id,v_src.note_id,p_provider,p_request_hash,p_payload) then
      raise exception 'Rehearsal identity has conflicting ownership, adapter or payload.' using errcode = '23514';
    end if;
  end if;
  return jsonb_build_object('jobId',v_job.id,'documentKey',v_job.document_key,'environment',v_job.environment,
    'providerId',v_job.provider_id,'payloadSha256',v_job.request_sha256,'state',v_job.status,'revision',v_job.revision,'updatedAt',to_char(v_job.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    || coalesce(v_job.response_snapshot,'{}');
end;
$$;

create or replace function public.cas_gst_irp_rehearsal(
  p_job uuid,p_outlet uuid,p_key text,p_provider text,p_hash text,p_revision integer,p_state text,p_next text,p_meta jsonb
) returns boolean language plpgsql set search_path = public, pg_temp as $$
declare
  v_op text := p_meta->>'operation';
  v_issue text := p_meta->>'issue';
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
      or not coalesce(case p_state when 'prepared' then p_next='dispatching'
        when 'dispatching' then p_next in ('reconcile','retryable','rejected')
        when 'reconcile' then p_next in ('reconcile','retryable')
        when 'retryable' then p_next='dispatching' else false end,false) then
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
    where id=v_job.id and revision=p_revision and status=p_state;
  if not found then return false; end if;
  insert into public.restaurant_irp_job_events(job_id,revision,state,operation,response)
    values(v_job.id,p_revision+1,p_next,v_op,p_meta);
  return true;
end;
$$;
revoke all on function public.reserve_gst_irp_rehearsal(uuid,uuid,text,text,text,jsonb),
  public.cas_gst_irp_rehearsal(uuid,uuid,text,text,text,integer,text,text,jsonb) from public, anon, authenticated, service_role;
comment on table public.restaurant_irp_job_events is 'Private, append-only through the local rehearsal store: job correlation, operation, revision and sanitized outcome/hash, never raw provider credentials or signed artifacts.';


-- A local void must not contradict an outstanding dispatch marker. The
-- matching claim holds FOR SHARE on this same source row until its CAS
-- commits; this trigger runs under the existing void RPC, with the update
-- lock held. Offline preflight or a merely prepared rehearsal is not dispatch.
create or replace function public.gst_guard_void_during_irp_rehearsal()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.restaurant_irp_jobs j where j.outlet_id=old.restaurant_id
    and j.environment='provider_test' and j.status in ('dispatching','reconcile')
    and case tg_table_name when 'restaurant_invoices' then j.invoice_id=old.id else j.note_id=old.id end) then
    raise exception 'Reconcile the outstanding IRP rehearsal before local void. Local void is not IRP cancellation.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.gst_guard_void_during_irp_rehearsal() from public, anon, authenticated, service_role;
create trigger gst_guard_invoice_void_during_irp_rehearsal before update of status on public.restaurant_invoices
  for each row when (old.status='issued' and new.status='voided') execute function public.gst_guard_void_during_irp_rehearsal();
create trigger gst_guard_note_void_during_irp_rehearsal before update of status on public.restaurant_notes
  for each row when (old.status='issued' and new.status='voided') execute function public.gst_guard_void_during_irp_rehearsal();
