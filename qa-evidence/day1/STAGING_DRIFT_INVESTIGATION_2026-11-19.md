# Report A — `autodinetest` staging-drift investigation (2026-11-19)

**Read-only investigation.** No migration was applied, rolled back or repaired,
no ledger row was edited, no table, function, policy or grant was changed, no
secret was read. Every hosted statement below came from `SELECT` queries and
metadata reads on the candidate project only. Production was not contacted.

**Verdict: STAGING DRIFT — EXPLAINED (updated 2026-11-19, after §4.1).** All
thirteen ledger entries are accounted for by repository evidence. The thirteenth
(`announcement_claim_recovery`) is an intentional change from the third
main-branch workstream (PR #195), applied 31 minutes before that PR merged. The
last schema effect without a ledger row —
`qr_verification_attempts_legacy_20261111054934` — is now **proven** to be the
documented 2026-11-11 review application of
`20261110000900_converge_qr_verification_attempts.sql` (§4.1). What remains
unknown is only *which tool* ran those sixteen files; the ledger's silence about
them is itself part of the record. One entry is an older revision than the file it
came from, which is a hardening delta, not drift.

**Verdict: STAGING BASELINE — NOT ELIGIBLE** (conditions in §9).

---

## 1. Identity and environment classification

Read-only metadata, 2026-11-19:

| Field | Value |
|---|---|
| Project name | `autodinetest` |
| Ref | `juwyhslzchjevqkdvwjm` |
| Region | `ap-northeast-2` |
| PostgreSQL | 17.11.0.018 |
| Status | ACTIVE_HEALTHY |
| Created | 2026-11-08T05:20:55Z |
| Organisation | `guhemsleylhtqoeicxli` (same as `autodine-production`) |

**Is it non-Production?** Yes, on three independent facts: it is a different
project ref from `autodine-production` (`bdbaqpevwmgdvghszjno`, `ap-south-1`,
PostgreSQL 17.11.0.003); its schema does not contain any of the branch's GST/IRP/
realtime objects (§5); and its ledger is a different, much shorter history.
It is a shared **test / preview** backend (the Preview runtime and the auth-email
setup both target it), not a designated Staging environment. Nothing in the
repository designates it as Staging — earlier phases explicitly recorded it as
"the only candidate, not an accepted Staging target".

## 2. The thirteen ledger entries

The ledger is `supabase_migrations.schema_migrations` (`version`, `name`,
`statements[]`, `created_by`). Versions are **apply timestamps**, not repository
file prefixes: e.g. `20261115051514 / report_sales_export_authorization`
corresponds to repository file `20261112000300_report_sales_export_authorization.sql`.
All thirteen rows carry `created_by = iamjarvis9896@gmail.com` — the owner
account — which is the only attribution the ledger itself supports; it is not
evidence of who ran a specific statement at a specific time.

| # | Version (apply time, UTC) | Name | What it is | Stored script vs repository |
|---|---|---|---|---|
| 1 | 2026-11-08 09:15:47 | `20261019000001_init` | Base schema | Documented in `docs/production-saas-readiness-audit.md` as this project's onboarding. 22,923 stored characters vs 22,926 in the file; **115 statements on both sides, statement set identical** (hash `32a1b06c…`). Same SQL, trailing blank lines trimmed. |
| 2 | 2026-11-08 09:16:23 | `20261019000002_public_read` | Anonymous storefront read fix | Same document. 1,067 stored characters vs 4,244 in the file: the long "why this exists" commentary was dropped. **9 statements on both sides, statement set identical** (`ed38217c…`) — function `restaurant_is_active` + the three public policies. |
| 3 | 2026-11-08 09:29:48 | `autodine_local_test_scaffold` | Local-only table scaffold | Documented as applied deliberately ("plus the explicitly marked local-only `autodine_local_test_scaffold`"). Its own first line says *"LOCAL HARNESS ONLY … Never use this inferred DDL as production schema"*. 5 statements, no repository counterpart. |
| 4 | 2026-11-08 09:30:06 | `20261020000004_counter_payment` | Counter payment RPC | Documented in the same onboarding. 5,116 vs 8,546 characters; 60 statements on both sides; comments dropped and a few statements reformatted, same operations. |
| 5 | 2026-11-08 17:46:55 | `20261021000005_public_place_order` | Public order entrypoint | Documented. 5,853 vs 12,459 characters; 72 statements on both sides; comments dropped, same operations. |
| 6 | 2026-11-08 17:47:35 | `20261021000006_table_qr_verification` | QR verification | Documented. 11,424 vs 18,903 characters; 133 statements on both sides; comments dropped, same operations. |
| 7 | 2026-11-08 17:47:58 | `20261021000007_table_qr_provisioning` | QR provisioning | Documented. 3,222 vs 10,398 characters; 40 statements on both sides. Compared statement by statement: **semantically identical**, the only differences being formatting (hosted `t.id=p_table_id` vs repository `t.id = p_table_id`). **This entry installed the two functions that carry findings QR-01/QR-02** (Report B §1.1) in their vulnerable form. |
| 8 | 2026-11-09 05:25:19 | `arena_staging_forward_upgrade_55` | Umbrella application of the 49-file bundle | **Content-addressed and independently verifiable** — see §2.2. |
| 9 | 2026-11-09 05:35:40 | `operational_readiness_catalog_probe` | Installs `operational_schema_readiness()` | Documented in `RELEASE-BLOCKER-REPORT.md`. 3 statements, no repository counterpart. Verified live: `SECURITY DEFINER`, `search_path = pg_catalog, public`, `EXECUTE` revoked from `public`/`anon`/`authenticated` and granted to `service_role` only. |
| 10 | 2026-11-13 11:50:07 | `owner_billing_configuration_guard` | Trigger restricting tax-rate/GSTIN edits to the owner | Documented in `docs/report-sales-staging-rehearsal-2026-11-15-result.md` ("created by the owner's account"). 1,881 vs 3,802 characters; 16 statements both sides. Verified live: function and `restaurants_billing_configuration_guard` trigger exist and check `has_restaurant_role(…,'owner')`. **One statement differs: repository `20261115000200` also revokes `EXECUTE` from `service_role`; the hosted revision does not.** Trigger functions cannot be invoked directly, so this is a hardening delta, not a hole. |
| 11 | 2026-11-15 05:15:14 | `report_sales_export_authorization` | Adds the owner/manager predicate to `report_sales` | Documented in `docs/gst-staging-application-plan-2026-11-15.md`. **Byte-identical** to `20261112000300_report_sales_export_authorization.sql` (both md5 `bc6eecb8…`), 21 statements both sides. Verified live: hosted `report_sales` now calls `has_restaurant_role`. This closed the "production is open" finding for this project. |
| 12 | 2026-11-15 11:31:53 | `fix_redeem_staff_invite_status_returns` | Single-use staff invite fix | Repository `20261115000100`. Identical except the file's trailing newline (5,150 vs 5,151 characters; 47 statements both sides). Verified live: `redeem_staff_invite` exists, `authenticated` only. |
| 13 | 2026-11-19 10:11:21 | `announcement_claim_recovery` | Stale-claim recovery for kitchen announcements | **Third main-branch workstream.** See §3. |

### 2.1 What the pattern tells us

Every row follows the same shape: version = the moment it was applied, name =
the file or change name, and `statements` = **one element containing the whole
script**. Five rows store the repository file with its comments intact
(`init`, `report_sales`, `fix_redeem…`, and the two non-repository probes);
five store the same SQL with the explanatory comments and the multi-line
formatting removed. That is the Supabase dashboard "new migration" flow, not
`supabase db push` (which records repository version prefixes). It is why the
ledger looks like "13 unexpected entries" to a checker that expects 119 file
versions: it is a **record of dashboard applications whose SQL came from this
repository**.

Because comments and line breaks were edited, comparing md5 of the stored text
with md5 of the file proves nothing on its own. The comparison above therefore
works on **statements**: strip comments, collapse whitespace, split on `;`,
hash each statement, and compare the resulting sets. On that basis every row
that has a repository counterpart is the same SQL, with the single documented
exception of `owner_billing_configuration_guard` (row 10).

### 2.2 Entry 8 is content-addressed — and the manifest checks out 50/50

The stored statement for `arena_staging_forward_upgrade_55` is not the upgrade
itself; it is a **pinned fetch and verify** of it:

```
create extension if not exists http with schema extensions;
do $upgrade$ … 
  if exists(select 1 from public.restaurants) or exists(select 1 from public.orders)
    then raise exception 'Refusing populated staging baseline'; end if;
  response := extensions.http_get(
    'https://api.github.com/repos/aryanp685/autodine/contents/scripts/staging/approved-upgrade.sql'
    '?ref=14a9391ef29e5c35323d3676f5e2844a5935b32b');
  … base64-decode …
  if sha256(source) <> 'd55a5828bb4771c671cc4c4cbd5dd1922d143a259eb75374bc27cb160e21c1db'
    then raise exception 'Pinned staging artifact checksum mismatch'; end if;
  execute source;
end $upgrade$;
drop extension http;
```

Verified on 2026-11-19, read-only, outside the database:

* The pinned commit exists. Fetching `scripts/staging/approved-upgrade.sql` at
  `14a9391e…` yields **sha256 `d55a5828…` — exactly the checksum the ledger
  statement enforces.** The bytes that ran on 2026-11-09 are therefore
  recoverable and provably the ones recorded.
* That artifact inserts **49** rows into
  `supabase_migrations.arena_staging_upgrade_manifest`, each with the SHA-256 of
  one migration file. The hosted manifest holds **50** rows: the 49 bundle rows
  plus `20261112000300_report_sales_export_authorization.sql`, timestamped
  **2026-11-15 05:15:35** — i.e. the report-export migration recorded itself in
  the same table when it was applied four days later. All 50 timestamps are
  consistent with that split.
* Of the 49 bundle rows, **48 match the current repository bytes exactly**. The
  exception, `20261109000400_order_write_boundary.sql`, carries
  `891b6dd75e69…`, which is the SHA-256 of that file **at the pinned commit**;
  the current file is `e604a331…` because it was revised afterwards (the later
  revision revokes every overload, as recorded in `PHASE-5`). The manifest is
  therefore not wrong — it is a faithful snapshot of what was applied.
* The extension the fetch needed (`http`) is not installed now; the statement
  drops it. Confirmed: `pg_extension` has no `http` or `pg_net` row.
* The guard confirms the bundle was applied to an **empty** baseline: no rows in
  `restaurants` or `orders` at the time. It says nothing about tables or
  functions that already existed — which is exactly why the scaffold and the six
  earlier entries remain part of the history.

## 3. `announcement_claim_recovery` — the 2026-11-19 entry

| Question | Answer | Evidence |
|---|---|---|
| Does it exist in this repository? | Not on this branch. **It exists on `origin/main`** as `supabase/migrations/20261119000400_announcement_claim_recovery.sql`. | `git ls-tree -r --name-only origin/main` |
| Which workstream introduced it? | The third main-branch workstream, PR **#195** *"Strict Scope Lock: Global Announcements (order+waiter), 4 controls, claim-recovery"*, head `arena/673db319-autodine`, **merged 2026-11-19T10:43:00Z**. | `gh pr view 195` (file list contains exactly this migration) |
| When was it applied hosted? | Version `20261119101121` = **2026-11-19 10:11:21 UTC** — 4 minutes after the PR was opened (10:07:24Z) and 31 minutes before it merged. | Ledger row + PR timestamps |
| What does it do? | `CREATE OR REPLACE` of `claim_kitchen_order_announcement(uuid)` adding a stale-claim delete (`claimed_at < now() - 2 min`) before the insert, re-issuing the same revoke/grant, and adding a partial index on `table_waiter_calls`. | Both the file and the stored statement |
| Is the stored SQL the file? | **Semantically identical, textually compacted.** 1,594 stored characters vs 2,704 characters on `main`; **19 statements on both sides**, and a side-by-side read shows the same statement, predicate, grants and index — the differences are the dropped header comments and the line breaks. The file was renumbered to `20261119000400` by merge commit `6f46581` ("renumber announcement_claim_recovery to 20261119000400"), which is why the ledger version (apply time) and the file version differ. | Side-by-side read of both, plus statement-count comparison |
| Did it take effect? | Yes. Live `claim_kitchen_order_announcement` is `SECURITY DEFINER`, `search_path=public, pg_temp`, `EXECUTE` to `authenticated` (+ owner/service_role), body contains the 2-minute stale window and the membership check. The partial index exists. | Catalogue query on the candidate |
| Is it safe? | Yes, within its design: caller must be signed in, the order's restaurant is read under `FOR UPDATE`, membership is required in `owner|manager|kitchen`, the stale delete is scoped to that one `order_id`, and only `authenticated` may call it. No cross-tenant path found. | Body review (Report B §3, row for this function family) |

**Conclusion:** intentional, correct, and consistent with the latest authorized
AutoDine development on `main`. It is *not* unexplained and not malicious. It
is, however, applied ahead of the merge and outside this branch's migration
chain, so it is one of the reasons the project cannot be called "this branch's
baseline".

## 4. Conditions of use that the ledger does not show

Two observations matter more than the entry list:

1. **`autodine_local_test_scaffold` is installed and its tables were not all
   replaced.** The scaffold was created to reconstruct missing tables for a local
   harness. The 49-file bundle later installed the real definitions, but no
   evidence shows the scaffold's tables were dropped; the 42 public tables are
   all also created by repository migrations, so the outcome is consistent — yet
   the channel that created them first is not a migration.
2. **One schema effect has no ledger entry and no manifest row** —
   `public.qr_verification_attempts_legacy_20261111054934`. Its origin is now
   **proven** (§4.1). Only the *tool* that ran it is unrecorded.

### 4.1 `qr_verification_attempts_legacy_20261111054934` — proven origin

**Classification: proven origin. The executing tool is probable, not proven.**

| Question | Answer | Evidence |
|---|---|---|
| What is it? | A regular table (`relkind = r`), owner `postgres`, RLS enabled, `ACL = {postgres=arwdDxtm, service_role=arwdDxtm}` — no `anon`/`authenticated` grant. 16 kB, **0 rows**, no comment. 4 columns: `id bigint` (default `nextval('qr_verification_attempts_id_seq')`), `qr_code_id uuid`, `ip_hash text`, `attempted_at timestamptz`. 2 constraints, 1 index. | `pg_class`, `information_schema.columns`, `pg_constraint`, `count(*)` |
| Is it the old or the new shape? | The **old, pre-convergence event-log shape**. The live `qr_verification_attempts` is the canonical 6-column counter (`qr_code_id, ip_hash, attempt_count, window_started_at, blocked_until, updated_at`, PK `(qr_code_id, ip_hash)`). | same |
| What created it? | `supabase/migrations/20261110000900_converge_qr_verification_attempts.sql`. Its guard detects a non-canonical table, renames indexes and constraints with a `YYYYMMDDHH24MISS` suffix, then renames the table to `qr_verification_attempts_legacy_<suffix>` and creates the canonical table in its place. Nothing is dropped. | migration source, read in full |
| When? | **2026-11-11 05:49:34 UTC.** The suffix is `to_char(statement_timestamp(), …)` — the exact moment the block ran — and it matches the `docs/review-deployment-2026-11-11.md` application of 16 files to this project. | suffix + that document |
| Can it be forged by coincidence? | No. The PK is named `qr_verification_attempts_pkey_20261111054934_20261111054934` — a **double suffix**. Reproduced on a disposable database: renaming the PK index also renames the constraint, so the migration's second (constraint) loop suffixes the already-suffixed name again. That fingerprint exists only if this exact file ran exactly once. | `scripts/local-pg` rename probe, 2026-11-19 |
| Is it documented? | Yes, explicitly. `docs/review-deployment-2026-11-11.md` §5 lists `20261110000900_converge_qr_verification_attempts` among "16 applied, in order", and the following subsection names this table: "preserved the old table as `qr_verification_attempts_legacy_20261111054934` (4 columns, 0 rows) … Both tables are now present … This is the previously open reconciliation question, answered on a real hosted database". A later note calls it "intentional evidence, not debris". | that document |
| Why no ledger row? | The 16 files of that review deployment were applied without writing `supabase_migrations.schema_migrations`. The ledger has entries for 2026-11-08, 2026-11-09, 2026-11-13 and 2026-11-15 — none for 2026-11-11. | ledger dump (13 rows) |
| Which tool? | **Not recorded anywhere.** `supabase db push` writes ledger rows and cannot produce this state; a direct execution (psql, or the dashboard SQL editor without "create migration") can, and is the probable channel. This report does not claim which. | absence of evidence, stated as such |
| Is anything referencing it? | **No.** No function body, view, policy, trigger or column default mentions it. Only the leftover sequence `qr_verification_attempts_id_seq` remains attached to its `id` default. | `pg_proc.prosrc`, `pg_policies`, `pg_trigger`, `pg_attrdef` sweep |
| Does it carry data? | **No — 0 rows**, and it has carried none since the rename (the source table was empty, per the 2026-11-11 document). | `count(*)` |
| Is it a security risk? | **No.** RLS is on, `anon`/`authenticated` hold no privilege, nothing calls it, and it holds no data. It is inert storage. | grants + reference sweep |
| Is it still required? | Functionally no; evidentially yes. It is the only surviving record of what shape this project's table had before the convergence, and the 2026-11-11 document says so. | judgement, stated as such |

**What this changes:** the anomaly is no longer "unexplained". The verdict moves
from *one unexplained element* to *one unrecorded tool*. Dropping the table
remains a hosted mutation and is **not authorised**; the recommendation is to
leave it until the target is either accepted with its history recorded or
replaced.

## 5. Repository versus hosted comparison

Read-only catalogue counts on the candidate: **42 public tables (all with RLS
enabled), 51 policies, 110 public functions, 91 `SECURITY DEFINER` functions, 15
triggers.**

| Comparison | Result |
|---|---|
| Functions defined by this branch but absent hosted | **92** — the GST/IRP documents, the IRP execution sidecar, the guest-checkout integrity and realtime projections. Expected: none of those files is authorized for hosted application. |
| Hosted functions not defined by any repository migration | **1** — `rls_auto_enable`, a Supabase platform helper. No unexplained function. |
| Hosted tables not defined by any repository migration | **0** — the one legacy-renamed table is a rename performed by a repository migration (§4.1). |
| Main's `20261119000300_public_guest_gst_quote` | **Absent** (`public_restaurant_gst` does not exist). Main's newest guest-GST feature is not deployed here. |
| Main's `20261119000200_new_outlet_tax_default` | **Effect already true** (`restaurants.tax_rate_bps` default is `0`), from bundle file `20261021000500_restaurant_settings.sql`, which sets the same default. The column comment is still the original one, so main's comment change is not applied. |
| Main's `20261119000100_restore_receipt_helper_boundary` | **Effect already true**: `issue_closed_session_receipt` has `EXECUTE` for `postgres` only, because bundle file `20261108008000_p8_require_settlement_before_close.sql` already revoked it. The main-branch file is therefore a no-op on this project. |
| GST / IRP / realtime surface | **Absent**: no `restaurant_gst_config`, `restaurant_irp_jobs`, `irp_dispatches`, `irp_routes`, `restaurant_credit_notes`, `outlet_revisions`. No IRP provider, route or credential exists here. |
| Security-relevant live definitions | `report_sales` → role predicate present. `guard_restaurant_billing_configuration` → role check present (earlier revision, §2 row 10). `rotate_table_qr_code` / `retire_table_qr_code` → **entitlement check only, membership check absent, `EXECUTE` to `authenticated`** (Report B §1.1). |

## 6. Security and product impact of the observed state

| Area | Impact |
|---|---|
| Tenant isolation | Two confirmed cross-tenant defects are **live on this project** (Report B findings QR-01/QR-02). They are branch-reproducible and the local fix exists; applying it here needs authorization. |
| Financial records | No financial drift found: the payment ledgers, receipts and invoices present are the ones the bundle and the two owner-applied migrations define. `owner_billing_configuration_guard` protects tax-rate/GSTIN edits. |
| GST / IRP | No GST configuration, no invoice authority, no IRP route or dispatch exists. Nothing here can issue a tax document or an IRN. |
| Realtime | No realtime projections or publication change from P4 are installed. |
| Authentication | No auth schema change was made by these entries; `staff_email` remains owner-executable only. |
| Data | No customer data was read. The project is a synthetic/preview backend. |

## 7. Root cause

The project was bootstrapped by hand on 2026-11-08 (three repository migrations +
an explicitly local scaffold), then upgraded by a 49-file bundle on 2026-11-09,
then by four owner/dashboard migrations between 2026-11-13 and 2026-11-15, and
finally by the third workstream's announcement migration on 2026-11-19. Because
each was applied through the dashboard, the ledger records apply-time versions
and compacted SQL rather than repository versions. **This is documented,
deliberate history — not tampering.** The two artefacts to resolve are the
2026-11-11 QR-converge side effect (unknown channel) and the pre-hardening
`owner_billing_configuration_guard` revision.

Not attributed: no evidence identifies an individual operator or a specific
tool for the 2026-11-11 effect, and this report does not guess.

## 8. Owner decisions required

| # | Decision | Why it blocks acceptance |
|---|---|---|
| A1 | Confirm the 2026-11-19 announcement migration was your third workstream's (PR #195) and that applying it to `autodinetest` before merge was intentional | It is the newest change; acceptance evidence must name its provenance |
| A2 | **Resolved** — the 2026-11-11 `qr_verification_attempts_legacy_*` effect is proven (§4.1). Only a disposition is needed: keep it as evidence (recommended) or authorise its removal later. The tool that ran the sixteen 2026-11-11 applications is still unrecorded; name it if you know it | Inert, 0 rows, no readers — evidence, not a blocker |
| A3 | Decide whether `autodinetest` is the Staging target, or create a dedicated one | Everything downstream depends on it |
| A4 | Authorize (or refuse) the QR-boundary migration `20261118002200` for that target | Two live cross-tenant defects (Report B) |
| A5 | Decide whether the pre-hardening `owner_billing_configuration_guard` revision should be re-applied from the repository file | Defence-in-depth delta, not a hole |
| A6 | Decide whether `autodine_local_test_scaffold` should be dropped from the target before acceptance | Inferred DDL should not sit under a Staging label |

## 9. Safe path to a clean authorized Staging baseline

1. **Do not reset or repair** `autodinetest` to match this branch. That would
   destroy the third workstream's intentional change and hide the history.
2. Record the accepted ledger as-is, with the provenance table in §2, and treat
   `announcement_claim_recovery` as part of the baseline.
3. Record a disposition for the legacy table (A2 — origin now proven) and decide A5/A6.
4. Authorize the QR-boundary correction **first**, because it closes live
   cross-tenant defects, and it is forward-only and signature-preserving.
5. Only then decide the migration set for this branch's GST/IRP/P3/P4 files —
   they are 26 + 2 files that are individually **NOT AUTHORIZED**, and applying
   them is what would make this project "the branch's schema".
6. Re-run the 14 acceptance points in
   [`docs/staging-authorization-and-acceptance-2026-11-19.md`](../../docs/staging-authorization-and-acceptance-2026-11-19.md)
   against whatever target is chosen, and capture evidence per point.

**Eligibility today: NOT ELIGIBLE** — no designation (A3), two live cross-tenant
defects (A4), and a scaffold installed (A6). The former "unexplained schema
effect" was closed on 2026-11-19 (§4.1), which removes one blocker and leaves
only decisions.
