-- One live table QR at the database level, step 1: collapse duplicates.
--
-- Ported from the hosted applications of the same correction (production ledger
-- 20261120190546_qr_code_staff_boundary, candidate 20261120190508) which had no
-- repository file. 20261118002200 added the membership gates but relied on a
-- `for update` row lock alone; this migration adds the invariant that survives
-- a writer which never takes that lock, and the advisory lock that serialises
-- rotation on the table id.
--
-- Split from the index on purpose. Updating table_qr_codes fires
-- revoke_sessions_on_qr_revocation, which leaves pending trigger events on the
-- table until the transaction commits, and PostgreSQL refuses CREATE INDEX on a
-- table with pending trigger events ("cannot CREATE INDEX ... because it has
-- pending trigger events", SQLSTATE 55006). Replaying the whole chain in one
-- session - which is what scripts/verify-database.mjs does - hit exactly that.
-- One file per transaction means the events flush before the index is built.
--
-- 1. Collapse any duplicate live cards, keeping the newest, so the unique index
--    can be created on a database that already drifted.
do $$
declare
  t uuid;
begin
  for t in
    select table_id
    from public.table_qr_codes
    where revoked_at is null
    group by table_id
    having count(*) > 1
  loop
    update public.table_qr_codes
       set revoked_at = now()
     where id in (
       select id from public.table_qr_codes
       where table_id = t and revoked_at is null
       order by created_at desc
       offset 1
     );
  end loop;
end;
$$;
