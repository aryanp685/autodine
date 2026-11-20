-- Priority 2 sidecar. Fiscal rows and predecessor preflight/rehearsal rows
-- stay immutable. No provider, secrets, runtime worker grant or routing data
-- installed. Browser roles may only request work and read explicit projections.
create table public.irp_routes (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.restaurants(id) on delete restrict,
  seller_gstin text not null check (seller_gstin ~ '^[0-9A-Z]{15}$'),
  tier text not null check (tier in ('simulation','authority')),
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9-]{2,39}$'),
  api_version text not null check (api_version ~ '^[A-Za-z0-9.-]{1,24}$'),
  schema_version text not null check (schema_version='1.1'),
  signer_fingerprint text not null check (signer_fingerprint ~ '^[a-f0-9]{64}$'),
  available boolean not null default false,
  interval_ms integer not null default 1000 check (interval_ms between 1 and 60000),
  next_slot timestamptz not null default '-infinity',
  unique (outlet_id,id),
  check ((tier='simulation')=(provider_key like 'sim-%')),
  constraint irp_authority_not_provisioned check (not available or tier='simulation')
);
create table public.irp_route_choices (
  outlet_id uuid primary key references public.restaurants(id) on delete restrict,
  route_id uuid,
  revision integer not null check (revision > 0),
  foreign key (outlet_id,route_id) references public.irp_routes(outlet_id,id),
  changed_by uuid not null,
  changed_at timestamptz not null default statement_timestamp()
);
create table public.irp_route_events (
  outlet_id uuid not null references public.restaurants(id) on delete restrict,
  revision integer not null,
  route_id uuid references public.irp_routes(id) on delete restrict,
  actor uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(outlet_id,revision)
);
create table public.irp_dispatches (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.restaurants(id) on delete restrict,
  preflight_id uuid not null references public.restaurant_irp_jobs(id) on delete restrict,
  route_id uuid not null,
  foreign key (outlet_id,route_id) references public.irp_routes(outlet_id,id),
  tier text not null check (tier in ('simulation','authority')),
  document_key text not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  rule_version text not null check (rule_version='13-2020-amended-10-2023'),
  issue_date date not null,
  reporting_category text not null check (reporting_category in ('under_10cr','at_least_10cr')),
  reporting_deadline date,
  attempted_deadline date, -- strictest deadline applicable to an attempted send
  phase text not null check(phase in ('queued','dispatching','ambiguous','lookup_queued','looking_up',
    'retryable','rejected','accepted','expired','source_unavailable','cancel_queued','cancelling','cancel_ambiguous',
    'cancel_lookup_queued','looking_up_cancel','cancelled')),
  revision integer not null default 0 check (revision >= 0),
  generation_attempts integer not null default 0 check (generation_attempts between 0 and 8),
  cancellation_attempts integer not null default 0 check (cancellation_attempts between 0 and 4),
  lookup_attempts integer not null default 0 check (lookup_attempts between 0 and 30),
  lease_token uuid,
  lease_until timestamptz,
  next_action_at timestamptz not null default clock_timestamp(),
  cancel_reason text check (cancel_reason in ('1','2','3','4')),
  cancelled_at timestamptz,
  requested_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(tier,document_key), unique(tier,preflight_id),
  check ((phase in ('dispatching','cancelling','looking_up','looking_up_cancel')) = (lease_token is not null and lease_until is not null)),
  check ((lease_token is null)=(lease_until is null)),
  check ((phase='cancelled')=(cancelled_at is not null)),
  check ((reporting_category='at_least_10cr')=(reporting_deadline is not null))
);
create index irp_dispatch_queue on public.irp_dispatches(route_id,phase,next_action_at,id);
create index irp_dispatch_outlet_register on public.irp_dispatches(outlet_id,issue_date,created_at desc,id);
create index irp_dispatch_expired_leases on public.irp_dispatches(outlet_id,route_id,lease_until) where lease_until is not null;
create table public.irp_dispatch_events (
  dispatch_id uuid not null references public.irp_dispatches(id) on delete restrict,
  revision integer not null,
  phase text not null,
  code text not null check(code in ('queued','claimed','lease_expired','owner_retry','owner_lookup','owner_cancel',
    'window_expired','source_unavailable','verified','declined','duplicate','uncertain','invalid_reply','invalid_request',
    'confirmed_absent','not_sent','cancelled','confirmed_active','cancel_blocked')),
  actor uuid,
  reason_code text check(reason_code in ('1','2','3','4')),
  latency_ms integer check(latency_ms between 0 and 60000),
  response_sha256 text check(response_sha256 ~ '^[a-f0-9]{64}$'),
  at timestamptz not null default clock_timestamp(),
  primary key(dispatch_id,revision),
  check ((code='owner_cancel')=(reason_code is not null))
);
create table public.irp_verified_artifacts (
  dispatch_id uuid primary key references public.irp_dispatches(id) on delete restrict,
  tier text not null check(tier in ('simulation','authority')),
  reference text not null,
  ack_number text not null,
  acknowledged_at timestamptz not null,
  signer_fingerprint text not null check(signer_fingerprint ~ '^[a-f0-9]{64}$'),
  signed_invoice text not null check(length(signed_invoice) between 20 and 800000),
  signed_qr text not null check(length(signed_qr) between 20 and 2400),
  verified_at timestamptz not null default clock_timestamp(),
  unique(tier,reference),
  check (case tier when 'authority' then reference ~ '^[a-f0-9]{64}$' and ack_number ~ '^[1-9][0-9]{0,29}$'
    else reference ~ '^SIM-[a-f0-9-]{36}$' and ack_number ~ '^SIM-ACK-[a-f0-9-]{36}$' end)
);
alter table public.irp_routes enable row level security;
alter table public.irp_route_choices enable row level security;
alter table public.irp_route_events enable row level security;
alter table public.irp_dispatches enable row level security;
alter table public.irp_dispatch_events enable row level security;
alter table public.irp_verified_artifacts enable row level security;
revoke all on public.irp_routes,public.irp_route_choices,public.irp_route_events,public.irp_dispatches,public.irp_dispatch_events,public.irp_verified_artifacts
  from public,anon,authenticated,service_role;

create or replace function public.irp_require_owner(p_outlet uuid) returns void
language plpgsql set search_path=public,pg_temp as $$
begin
  perform 1 from public.memberships m where m.restaurant_id=p_outlet and m.user_id=auth.uid() and m.role='owner' for share;
  if not found or not public.restaurant_can_write(p_outlet) then
    raise exception 'An entitled owner of this outlet is required.' using errcode='42501';
  end if;
end;
$$;

-- Only a pre-provisioned route can be chosen. Its compatibility, credential
-- custody and signer trust are operator work; an Owner cannot supply a URL/key.
create or replace function public.choose_irp_route(p_outlet uuid,p_route uuid,p_revision integer) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_revision integer;
begin
  perform public.irp_require_owner(p_outlet);
  if p_route is not null and not exists (select 1 from public.irp_routes r join public.restaurant_gst_config c
    on c.restaurant_id=r.outlet_id and c.mode='regular' and c.gstin=r.seller_gstin where r.outlet_id=p_outlet and r.id=p_route and r.available) then
    raise exception 'No approved route matches this outlet and registration.' using errcode='23514';
  end if;
  if p_revision=0 then
    insert into public.irp_route_choices(outlet_id,route_id,revision,changed_by) values(p_outlet,p_route,1,auth.uid())
      on conflict(outlet_id) do nothing returning revision into v_revision;
  else
    update public.irp_route_choices set route_id=p_route,revision=revision+1,changed_by=auth.uid(),changed_at=clock_timestamp()
      where outlet_id=p_outlet and revision=p_revision returning revision into v_revision;
  end if;
  if v_revision is null then raise exception 'Routing changed. Reload its current version.' using errcode='40001'; end if;
  insert into public.irp_route_events(outlet_id,revision,route_id,actor) values(p_outlet,v_revision,p_route,auth.uid());
  return v_revision;
end;
$$;

-- Source lock is always taken before the dispatch row lock. Mirrors the
-- existing local-void lock order. Read only immutable document particulars.
create or replace function public.irp_source_snapshot(p_preflight uuid,p_outlet uuid) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare v public.restaurant_irp_jobs%rowtype; z jsonb; parent_id uuid;
begin
  select * into v from public.restaurant_irp_jobs where id=p_preflight and outlet_id=p_outlet
    and environment='offline' and status='prepared_offline';
  if not found then return null; end if;
  if v.invoice_id is not null then
    select jsonb_build_object('gst',gst_snapshot,'type',document_type,'status',status,'irp',irp_status,'seller',seller_snapshot->>'gstin') into z
      from public.restaurant_invoices where id=v.invoice_id and restaurant_id=p_outlet for share;
  else
    select invoice_id into parent_id from public.restaurant_notes where id=v.note_id and restaurant_id=p_outlet;
    perform 1 from public.restaurant_invoices where id=parent_id and restaurant_id=p_outlet and status='issued' for share;
    if not found then return null; end if;
    select jsonb_build_object('gst',gst_snapshot,'type',document_type,'status',status,'irp',irp_status,'seller',seller_snapshot->>'gstin') into z
      from public.restaurant_notes where id=v.note_id and restaurant_id=p_outlet for share;
  end if;
  return z;
end;
$$;

create or replace function public.queue_irp_dispatch(p_outlet uuid,p_preflight uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  z jsonb; v public.restaurant_irp_jobs%rowtype; r public.irp_routes%rowtype; d public.irp_dispatches%rowtype;
  issue_day date; today date := (clock_timestamp() at time zone 'Asia/Kolkata')::date; category text;
begin
  perform public.irp_require_owner(p_outlet);
  z := public.irp_source_snapshot(p_preflight,p_outlet);
  if z->>'status' is distinct from 'issued' or coalesce(z->>'irp','') not in ('pending','failed')
    or z->'gst'->'irp_evidence'->>'applicability' is distinct from 'required'
    or z->'gst'->'irp_evidence'->>'rule_version' is distinct from '13-2020-amended-10-2023' then
    raise exception 'An available IRN-required source and its offline preflight are required.' using errcode='23514';
  end if;
  select * into strict v from public.restaurant_irp_jobs where id=p_preflight;
  select rr.* into r from public.irp_route_choices c join public.irp_routes rr on rr.id=c.route_id and rr.outlet_id=c.outlet_id
    join public.restaurant_gst_config g on g.restaurant_id=rr.outlet_id and g.gstin=rr.seller_gstin and g.mode='regular'
    where c.outlet_id=p_outlet and rr.available and rr.seller_gstin=z->>'seller' and rr.schema_version=v.payload_version;
  if not found then raise exception 'No approved compatible route is selected.' using errcode='23514'; end if;
  select * into d from public.irp_dispatches where tier=r.tier and document_key=v.document_key;
  if found then
    if (d.outlet_id,d.preflight_id,d.request_sha256,d.route_id) is distinct from (p_outlet,v.id,v.request_sha256,r.id) then
      raise exception 'Reserved statutory identity has conflicting source or routing evidence.' using errcode='23514';
    end if;
    return d.id;
  end if;
  issue_day := (z->'gst'->>'issued_local_date')::date;
  category := z->'gst'->'irp_evidence'->>'reporting_category';
  if issue_day is null or issue_day<date '2023-08-01' or issue_day>today or today<date '2025-04-01'
     or coalesce(category,'') not in ('under_10cr','at_least_10cr') or (category='at_least_10cr' and today>issue_day+29) then
    raise exception 'The issue date or reporting window does not permit dispatch.' using errcode='23514';
  end if;
  insert into public.irp_dispatches(outlet_id,preflight_id,route_id,tier,document_key,request_sha256,rule_version,issue_date,
      reporting_category,reporting_deadline,phase,requested_by)
    values(p_outlet,v.id,r.id,r.tier,v.document_key,v.request_sha256,'13-2020-amended-10-2023',issue_day,category,
      case when category='at_least_10cr' then issue_day+29 end,'queued',auth.uid())
    on conflict(tier,document_key) do nothing returning * into d;
  if found then
    insert into public.irp_dispatch_events(dispatch_id,revision,phase,code,actor) values(d.id,0,'queued','queued',auth.uid());
  else
    select * into strict d from public.irp_dispatches where tier=r.tier and document_key=v.document_key;
    if (d.outlet_id,d.preflight_id,d.request_sha256,d.route_id) is distinct from (p_outlet,v.id,v.request_sha256,r.id) then
      raise exception 'Reserved statutory identity has conflicting source or routing evidence.' using errcode='23514';
    end if;
  end if;
  return d.id;
end;
$$;

create or replace function public.request_irp_dispatch_action(p_outlet uuid,p_job uuid,p_revision integer,p_action text,p_reason text default null) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.irp_dispatches%rowtype; v public.restaurant_irp_jobs%rowtype; z jsonb; code text; target text; ack timestamptz;
begin
  perform public.irp_require_owner(p_outlet);
  select * into d from public.irp_dispatches where id=p_job and outlet_id=p_outlet;
  if not found then raise exception 'Dispatch is unavailable in this outlet.' using errcode='42501'; end if;
  z := public.irp_source_snapshot(d.preflight_id,p_outlet);
  select * into strict d from public.irp_dispatches where id=p_job and outlet_id=p_outlet for update;
  if d.revision is distinct from p_revision then raise exception 'Dispatch status changed. Reload it.' using errcode='40001'; end if;
  if p_action='lookup' and p_reason is null and d.phase in ('ambiguous','cancel_ambiguous') and d.lookup_attempts<30 then
    target := case d.phase when 'ambiguous' then 'lookup_queued' else 'cancel_lookup_queued' end; code := 'owner_lookup';
  elsif p_action='retry' and p_reason is null and d.phase='retryable' and d.generation_attempts<8 and z->>'status'='issued'
      and (least(d.reporting_deadline,d.attempted_deadline) is null
        or (clock_timestamp() at time zone 'Asia/Kolkata')::date<=least(d.reporting_deadline,d.attempted_deadline)) then
    target := 'queued'; code := 'owner_retry';
  elsif p_action='cancel' and d.phase='accepted' and d.cancellation_attempts<4 and z->>'status'='issued' and p_reason in ('1','2','3','4') then
    select acknowledged_at into ack from public.irp_verified_artifacts where dispatch_id=d.id;
    if ack is null or clock_timestamp()<ack or clock_timestamp()>=ack+interval '24 hours' then
      raise exception 'The 24-hour cancellation window is unavailable or closed.' using errcode='23514';
    end if;
    select * into strict v from public.restaurant_irp_jobs where id=d.preflight_id;
    if v.invoice_id is not null and exists(select 1 from public.restaurant_notes n where n.invoice_id=v.invoice_id and n.status='issued') then
      raise exception 'Reconcile existing linked adjustments before asking for IRP cancellation.' using errcode='23514';
    end if;
    target := 'cancel_queued'; code := 'owner_cancel';
  else raise exception 'The requested action is not permitted in this dispatch state.' using errcode='23514'; end if;
  update public.irp_dispatches set phase=target,revision=revision+1,updated_at=clock_timestamp(),
    cancel_reason=case when p_action='cancel' then p_reason else cancel_reason end where id=d.id returning revision into d.revision;
  insert into public.irp_dispatch_events(dispatch_id,revision,phase,code,actor,reason_code)
    values(d.id,d.revision,target,code,auth.uid(),case when p_action='cancel' then p_reason end);
  return d.revision;
end;
$$;

-- Private worker protocol. A claim is committed before transport. Lease expiry
-- means uncertainty, not permission to send again. Only a matching, unexpired
-- token may finish. Stale outcomes must be recovered by authoritative lookup.
create or replace function public.claim_irp_dispatch(p_outlet uuid,p_route uuid,p_job uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  d public.irp_dispatches%rowtype; r public.irp_routes%rowtype; v public.restaurant_irp_jobs%rowtype;
  a public.irp_verified_artifacts%rowtype; z jsonb; target text; op text; refusal text;
  t timestamptz; today date; current_category text;
begin
  select * into d from public.irp_dispatches where outlet_id=p_outlet and route_id=p_route and (p_job is null or id=p_job)
    and phase in ('queued','lookup_queued','cancel_queued','cancel_lookup_queued') and next_action_at<=clock_timestamp()
    and (phase<>'queued' or exists(select 1 from public.irp_route_choices where outlet_id=p_outlet and route_id=p_route))
    order by case phase when 'cancel_queued' then 0 when 'cancel_lookup_queued' then 1 when 'lookup_queued' then 2 else 3 end,next_action_at,id limit 1;
  if not found then return null; end if;
  z := public.irp_source_snapshot(d.preflight_id,p_outlet);
  select * into d from public.irp_dispatches where id=d.id and phase in ('queued','lookup_queued','cancel_queued','cancel_lookup_queued')
    and next_action_at<=clock_timestamp() for update skip locked;
  if not found then return null; end if;
  select * into r from public.irp_routes where id=p_route and outlet_id=p_outlet and tier=d.tier and tier='simulation' for no key update;
  if not found then return null; end if;
  t := clock_timestamp(); today := (t at time zone 'Asia/Kolkata')::date;
  select * into strict v from public.restaurant_irp_jobs where id=d.preflight_id;
  select * into a from public.irp_verified_artifacts where dispatch_id=d.id;
  if z->>'status' is distinct from 'issued' or z->>'seller' is distinct from r.seller_gstin or v.request_sha256<>d.request_sha256
     or v.request_sha256 is distinct from encode(sha256(convert_to(v.request_payload::text,'UTF8')),'hex') then
    refusal := 'source_unavailable'; target := 'source_unavailable';
  elsif d.phase='queued' then
    if not public.restaurant_can_write(p_outlet) then return null; end if;
    perform 1 from public.irp_route_choices where outlet_id=p_outlet and route_id=p_route for share;
    if not found then return null; end if;
    perform pg_advisory_xact_lock_shared(hashtextextended('gst-outlet:' || p_outlet::text,0));
    -- Recheck the current reporting classification conservatively. Never
    -- loosen the immutable issue-time category or reprice the request.
    select c.activation->'aato'->>'reporting_category' into current_category from public.restaurant_gst_config c
      where c.restaurant_id=p_outlet and c.gstin=r.seller_gstin and c.mode='regular'
        and c.activation->'aato'->'review_fy'=to_jsonb(public.gst_financial_year_start(today));
    if public.gst_known_pan_turnover_paise(r.seller_gstin)>=10000000000 and current_category='under_10cr' then
      current_category := 'at_least_10cr';
    end if;
    t := clock_timestamp(); today := (t at time zone 'Asia/Kolkata')::date;
    if coalesce(current_category,'') not in ('at_least_10cr','under_10cr') then return null; end if;
    if today<d.issue_date or (least(d.attempted_deadline,d.reporting_deadline) is not null or current_category='at_least_10cr') and today>d.issue_date+29 then
      refusal := 'window_expired'; target := 'expired';
    else target := 'dispatching'; op := 'generate'; end if;
  elsif d.phase='cancel_queued' then
    if a.acknowledged_at is null or t<a.acknowledged_at or t>=a.acknowledged_at+interval '24 hours' then
      refusal := 'window_expired'; target := 'accepted'; -- no cancellation bytes sent
    elsif not public.restaurant_can_write(p_outlet) then return null;
    else target := 'cancelling'; op := 'cancel'; end if;
  elsif d.phase='lookup_queued' then target := 'looking_up'; op := 'lookup';
  else target := 'looking_up_cancel'; op := 'lookup_cancel';
  end if;
  if refusal is not null then
    update public.irp_dispatches set phase=target,revision=revision+1,updated_at=t where id=d.id;
    insert into public.irp_dispatch_events(dispatch_id,revision,phase,code) values(d.id,d.revision+1,target,refusal);
    return null;
  end if;
  if not r.available or r.next_slot>t then return null; end if;
  update public.irp_routes set next_slot=t+r.interval_ms*interval '1 millisecond' where id=r.id;
  update public.irp_dispatches set phase=target,revision=revision+1,updated_at=t,
    attempted_deadline=case when op='generate' then least(d.attempted_deadline,d.reporting_deadline,
      case when current_category='at_least_10cr' then d.issue_date+29 end) else d.attempted_deadline end,
    generation_attempts=generation_attempts+case when op='generate' then 1 else 0 end,
    cancellation_attempts=cancellation_attempts+case when op='cancel' then 1 else 0 end,
    lookup_attempts=lookup_attempts+case when op in ('lookup','lookup_cancel') then 1 else 0 end,
    lease_token=gen_random_uuid(),lease_until=t+interval '45 seconds' where id=d.id returning * into d;
  insert into public.irp_dispatch_events(dispatch_id,revision,phase,code) values(d.id,d.revision,d.phase,'claimed');
  return jsonb_build_object('id',d.id,'outlet',d.outlet_id,'token',d.lease_token,'operation',op,'documentKey',d.document_key,
    'leaseUntil',d.lease_until,'reportingDeadline',least(d.reporting_deadline,d.attempted_deadline), 'routeId',d.route_id,
    'request',v.request_payload,'seller',r.seller_gstin,'provider',r.provider_key,'apiVersion',r.api_version,
    'schemaVersion',r.schema_version,'tier',r.tier,'signerFingerprint',r.signer_fingerprint,'reason',d.cancel_reason,
    'reference',a.reference,'acknowledgedAt',a.acknowledged_at);
end;
$$;

create or replace function public.sweep_irp_leases(p_outlet uuid,p_route uuid) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
  with expired as (
    update public.irp_dispatches set phase=case when phase in ('cancelling','looking_up_cancel') then 'cancel_ambiguous' else 'ambiguous' end,
      lease_token=null,lease_until=null,updated_at=clock_timestamp(),revision=revision+1,
      next_action_at=clock_timestamp()+interval '120 seconds'
      where outlet_id=p_outlet and route_id=p_route and lease_until<=clock_timestamp() returning id,phase,revision
  ) insert into public.irp_dispatch_events(dispatch_id,revision,phase,code) select id,revision,phase,'lease_expired' from expired;
  get diagnostics n=row_count;
  return n;
end;
$$;

create or replace function public.finish_irp_dispatch(p_job uuid,p_token uuid,p_code text,p_ms integer,p_digest text,p_evidence jsonb default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  d public.irp_dispatches%rowtype; a public.irp_verified_artifacts%rowtype; r public.irp_routes%rowtype;
  t timestamptz; ack timestamptz; cancellation timestamptz; target text; z jsonb;
begin
  select * into d from public.irp_dispatches where id=p_job and lease_token=p_token;
  if not found then return false; end if;
  z := public.irp_source_snapshot(d.preflight_id,d.outlet_id);
  select * into d from public.irp_dispatches where id=p_job and lease_token=p_token and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  t := clock_timestamp();
  if d.lease_until<=t or d.tier<>'simulation' then return false; end if;
  if z->>'status' is distinct from 'issued' or p_ms is null or p_ms not between 0 and 60000
     or (p_digest is not null and p_digest !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid outcome boundary.' using errcode='23514';
  end if;
  if p_code='verified' and d.phase in ('dispatching','looking_up') then
    select * into strict r from public.irp_routes where id=d.route_id;
    if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence - array['reference','number','at','invoice','qr','signer']<>'{}'::jsonb
      or p_evidence->>'signer' is distinct from r.signer_fingerprint or p_digest is null then
      raise exception 'Verified outcome requires pinned, request-bound evidence.' using errcode='23514';
    end if;
    ack := (p_evidence->>'at')::timestamptz;
    if ack is null or ack>t+interval '5 seconds' or (ack at time zone 'Asia/Kolkata')::date<d.issue_date
       or (least(d.reporting_deadline,d.attempted_deadline) is not null
         and (ack at time zone 'Asia/Kolkata')::date>least(d.reporting_deadline,d.attempted_deadline)) then
      raise exception 'The acknowledgment date does not match this source.' using errcode='23514';
    end if;
    insert into public.irp_verified_artifacts(dispatch_id,tier,reference,ack_number,acknowledged_at,signer_fingerprint,signed_invoice,signed_qr)
      values(d.id,d.tier,p_evidence->>'reference',p_evidence->>'number',ack,r.signer_fingerprint,p_evidence->>'invoice',p_evidence->>'qr');
    target := 'accepted';
  elsif p_code='cancelled' and d.phase in ('cancelling','looking_up_cancel') then
    select * into strict a from public.irp_verified_artifacts where dispatch_id=d.id;
    if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence - array['reference','at']<>'{}'::jsonb
      or p_evidence->>'reference' is distinct from a.reference or p_digest is null then
      raise exception 'Cancellation evidence does not match the accepted response.' using errcode='23514';
    end if;
    cancellation := (p_evidence->>'at')::timestamptz;
    if cancellation is null or cancellation<a.acknowledged_at or cancellation>=a.acknowledged_at+interval '24 hours'
       or cancellation>t+interval '5 seconds' then
      raise exception 'Cancellation evidence has an invalid recorded time.' using errcode='23514';
    end if;
    target := 'cancelled';
  elsif p_evidence is null then
    target := case d.phase
      when 'dispatching' then case when p_code='not_sent' then 'retryable' when p_code in ('declined','invalid_request') then 'rejected'
        when p_code in ('duplicate','uncertain','invalid_reply') then 'ambiguous' end
      when 'looking_up' then case when p_code='confirmed_absent' then 'retryable' when p_code in ('uncertain','invalid_reply') then 'ambiguous' end
      when 'cancelling' then case when p_code in ('declined','not_sent','cancel_blocked') then 'accepted'
        when p_code in ('uncertain','invalid_reply') then 'cancel_ambiguous' end
      when 'looking_up_cancel' then case when p_code='confirmed_active' then 'accepted'
        when p_code in ('uncertain','invalid_reply') then 'cancel_ambiguous' end
    end;
  end if;
  if target is null then raise exception 'Outcome does not match the claimed operation.' using errcode='23514'; end if;
  update public.irp_dispatches set phase=target,revision=revision+1,updated_at=t,lease_token=null,lease_until=null,cancelled_at=cancellation,
    next_action_at=t+case when target in ('ambiguous','cancel_ambiguous') then interval '120 seconds'
      when target='retryable' then least(60,2^(greatest(d.generation_attempts,1))) * interval '1 second' else interval '0 seconds' end
    where id=d.id;
  insert into public.irp_dispatch_events(dispatch_id,revision,phase,code,latency_ms,response_sha256)
    values(d.id,d.revision+1,target,p_code,p_ms,p_digest);
  return true;
end;
$$;

-- Lock/share parity with worker claims; do not reuse a number or locally void
-- a source with a possibly accepted, accepted, or cancelled external record.
create or replace function public.irp_guard_source_void() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists (select 1 from public.irp_dispatches d join public.restaurant_irp_jobs j on j.id=d.preflight_id
    where d.outlet_id=old.restaurant_id and d.phase not in ('queued','retryable','rejected','expired','source_unavailable')
      and old.id=case tg_table_name when 'restaurant_invoices' then j.invoice_id else j.note_id end) then
    raise exception 'Reconcile IRP evidence before local void. IRP cancellation is a separate operation.' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger irp_guard_invoice_source_void before update of status on public.restaurant_invoices
  for each row when(old.status='issued' and new.status='voided') execute function public.irp_guard_source_void();
create trigger irp_guard_note_source_void before update of status on public.restaurant_notes
  for each row when(old.status='issued' and new.status='voided') execute function public.irp_guard_source_void();

create or replace function public.irp_preserve_evidence() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'IRP evidence is append-only.' using errcode='23514';
end;
$$;
create trigger irp_event_append_only before update or delete on public.irp_dispatch_events
  for each row execute function public.irp_preserve_evidence();
create trigger irp_routing_event_append_only before update or delete on public.irp_route_events
  for each row execute function public.irp_preserve_evidence();
create trigger irp_artifact_append_only before update or delete on public.irp_verified_artifacts
  for each row execute function public.irp_preserve_evidence();
create trigger irp_route_identity_immutable before update on public.irp_routes for each row
  when ((to_jsonb(old)-array['available','interval_ms','next_slot']) is distinct from
        (to_jsonb(new)-array['available','interval_ms','next_slot'])) execute function public.irp_preserve_evidence();

revoke all on function public.irp_preserve_evidence(),public.irp_require_owner(uuid),public.irp_source_snapshot(uuid,uuid),public.irp_guard_source_void(),
  public.claim_irp_dispatch(uuid,uuid,uuid),public.sweep_irp_leases(uuid,uuid),public.finish_irp_dispatch(uuid,uuid,text,integer,text,jsonb),
  public.choose_irp_route(uuid,uuid,integer),public.queue_irp_dispatch(uuid,uuid),public.request_irp_dispatch_action(uuid,uuid,integer,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.choose_irp_route(uuid,uuid,integer),public.queue_irp_dispatch(uuid,uuid),
  public.request_irp_dispatch_action(uuid,uuid,integer,text,text) to authenticated;
