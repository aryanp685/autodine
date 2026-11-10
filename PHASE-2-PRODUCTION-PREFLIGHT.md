# Production rollout preflight

User explicitly authorized production rollout, superseding earlier production
read-only restriction. No production mutation has yet been performed.

## Release reconciliation

Local branch pointer was at 7dae9b4 although release changes were present in the
working tree. Fetched the existing session branch and compared all 15 release
files byte-for-byte with remote 64ce1ea: no mismatches. Moved the same branch
pointer/index to the remote commit using mixed reset; no file content was
overwritten. Only the separate staging preflight report remained untracked.
Exact release SHA GitHub checks pass; PR174 remains open, with no reviews.

## Production read-only findings

Target: autodine-production, bdbaqpevwmgdvghszjno.

- Ledger ends with 20261108000200 drift_reconcile. It does not record the
  subsequent 20261109 migrations or the four 20261110 migrations.
- operational_schema_readiness() is absent, independently confirming at least
  one prerequisite is missing (not merely a ledger filename discrepancy).
- place_public_order_attempt is absent; legacy six-argument place_public_order
  is present and executable by anon.
- hit_rate_limit(text,integer,integer) and current_table_session(text) exist.
- Four financial function bodies lack the new FOR UPDATE OF s pattern.
- Production body hashes differ from the previously inspected staging bodies;
  staging cannot be treated as an exact production-schema rehearsal.

Captured md5(prosrc):

| Function | Hash |
|---|---|
| cancel_order | c985a21c24240de3b1c7386bbd01a5aa |
| open_table_session | 1e28252b1852ad094c636198f2168d0e |
| place_public_order | 96950f08e083e35e8e7f0ece7e1692f5 |
| record_counter_payment | 8fe311e536fc3737be9b9b2d9ae16ed8 |
| set_order_line_quantities | 369c4e7615aa47188763223c65315da8 |
| settle_online_payment | 5005ec641a11ca6b6b08d8dcf9761bcb |

## Execution gates

This is not a four-migration-only production delta. Review/reconcile prerequisite
migrations 20261109000100 through 20261109001000 before applying Phase1/2.
Do not blindly push full repository history; production contains historical
migration versions and function drift.

The enabled Supabase connector has no backup enumeration/creation/restore
verification endpoint. Hosted restore readiness has not been established.
No direct database credential or local Supabase/Vercel CLI is available.
An actual guest/RPC maintenance-and-drain mechanism has not been established;
a page banner or app pause alone cannot gate direct RPC clients. No pause was
performed merely to discover later that rollout is blocked.

Before irreversible production cutover: establish backup/restore readiness,
review exact drift-aware delta and coordinated rollback, and establish real
ordering admission restriction/drain with matching app deployment. Independent
review is outstanding. General deployment authorization does not supply these
technical capabilities. No customer fixtures, payments, counters or order rows
were modified by this preflight. No production load test was run.

## Latest rehearsal evidence (user's trusted Mac)

User reported successful pg_dump and archive listing (both exit 0, ~939 KB),
then restored the archive into an isolated local Supabase PostgreSQL
17.11.0.018 environment. Initial vanilla-PG restore lacked pg_cron; this was
not bypassed. Local cron.launch_active_jobs=off was verified after restart,
cron.database_name=restorecheck, and all DB container networks were disconnected
before restore. Supabase-compatible restore exited 0. A checksum was saved
locally. Archive/customer data have not been uploaded to this workspace.

Initial pending migration rehearsal failed because production has
place_order(text,jsonb,text), not the assumed four-argument legacy signature.
Fix cbc4fcb4413b9370a8918af56d336bef19af8dab enumerates and revokes all retired
public.place_order function overloads; regression covers missing four-arg and
zero-legacy cases. User pulled exact fix, rebuilt bundle and reported local
single-transaction rehearsal exit 0.

Post-rehearsal user-supplied catalog output:
- retired three-arg place_order and six-arg place_public_order: anon and
  authenticated execute=false;
- place_public_order_attempt: both execute=true;
- 20 orders / 30 order_items unchanged;
- readiness: invoices, settlement, orderSessions, paymentReceipts and
  announcementClaims all true;
- user confirmed anon/authenticated table INSERT checks both false.

These are user-run local results, not agent-observed hosted HTTP tests. Restore
used --no-owner --no-privileges; full ownership/ACL recovery is not verified.
No customer-data invariants beyond these counts have been established.

Latest GitHub checks on cbc4fcb all pass: PostgreSQL15/17/18 native migration,
SQL boundary/recovery, static/unit/build, browser, TTS and Vercel preview. PR174
remains OPEN with no independent reviews. No merge or production migration was
performed. A repository search found no existing explicit maintenance admission
switch; absence of those strings alone is not proof no external mechanism
exists. Before production cutover, prepare/verify a DB-level ordering RPC gate
covering direct callers, coordinate matching app deployment, drain in-flight
work and establish coordinated rollback. Do not pause production traffic while
these capabilities are still being discovered.

## Merge safety hold

The repository documents that merging deploys main, but contains no automatic
hosted migration step. To permit the requested code merge without knowingly
shipping the new-RPC app against the old hosted schema, vercel.json disables
automatic Git deployment for main. This is not a guest admission gate and does
not stop existing apps or direct RPC clients. It is a temporary release hold;
manual deployments must also remain held until coordinated cutover. Re-enable
main automatic deployment only after matching hosted schema/app verification.
Verify provider-side deployment status after merge; a config rule is not proof
that no deployment occurred. Production schema cutover remains unexecuted.
