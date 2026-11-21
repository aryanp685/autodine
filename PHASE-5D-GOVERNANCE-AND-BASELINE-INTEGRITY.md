# Phase 5D — Governance Gate & Baseline Integrity Review

**Disposition: NO-GO for any Staging migration.** This is a draft operator-acceptance package for Aryan to review and share manually. It has not been sent; no operator approval, backup evidence, or migration authorization is asserted. No SQL migration payload is included.

## 1. Baseline integrity investigation

### Git state and exact diff

At review time, `scripts/phase3/staging-baseline.json` has an **unstaged worktree modification** and no staged change. `git status --porcelain=v2` reports `1 .M ...`; `git diff --cached --quiet` exits 0, while `git diff --quiet -- scripts/phase3/staging-baseline.json` exits 1. Its index entry is identical to `HEAD` (mode `100644`, Git blob `2f47477f1cf1bf378b8225fc72cbc49d825a0849`).

**Current worktree SHA-256:** `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb`

**`HEAD` version SHA-256:** `5ca4325ea7a070c9b98c06fb28655b2e2b826156c693283e1904c3eec8c9841f`

**Current worktree Git blob:** `24722fb75752adb3dc576d271f5c09737bf9093f`

**`HEAD` Git blob:** `2f47477f1cf1bf378b8225fc72cbc49d825a0849`

The exact diff is two insertions and no deletions (1 file changed, 2 insertions, 0 deletions):

```diff
@@ -3,0 +4 @@
+    {"signature":"begin_online_payment(text,text,text,uuid,uuid,bigint)","body_hash":"35f77b0e60c17f14907aab6ebe588a38","acl":"{postgres=X/postgres,service_role=X/postgres}","settings":["search_path=public, pg_temp"]},
@@ -4,0 +6 @@
+    {"signature":"close_order_session_and_issue_receipt(uuid)","body_hash":"aa91f0ae7000bd92c736439bc59abcb0","acl":"{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}","settings":["search_path=public, pg_temp"]},
```

The additions expand the expected function set from the **seven entries in the committed `HEAD` file to nine in the worktree**. They do not alter the `projectRef` or any of the original seven signatures, body hashes, ACLs, or search paths. They add two new expected signatures, hashes, ACLs, and `search_path` settings.

### Metadata and Git history

- Worktree file: mode `0644`, 2,147 bytes, inode `529426`.
- Filesystem metadata reported mtime/ctime/birth time `2026-11-12 11:53:54.257208709 +0000`. Treat these timestamps as observations only, not reliable authorship or approval evidence: the Phase 5C report records a disagreement between the Arena-provided date (`2026-11-06`) and the sandbox/PostgreSQL clock (`2026-11-12`).
- `git log --follow` shows the file introduced in `HEAD` `8ae4feb01459238ffbace429a7ef1859529ef702` (merge of PR #175, “Phase 3: guarded baseline runner and native staging reconstruction”) and no later committed file revision. The two additions are not in Git history.
- There is **known workstream context** for the additions: the uncommitted Phase 3 report says the original read-only snapshot held seven functions while the rehearsal guard was extended to nine, specifically adding `begin_online_payment` and `close_order_session_and_issue_receipt`; the uncommitted rehearsal builder lists the same nine signatures. This makes the diff consistent with a prior Phase 3 rehearsal extension. It does **not** prove who edited the JSON, the exact edit time, or that the nine-row worktree file was approved as a replacement for the original pinned snapshot. The report, builder, and JSON changes are uncommitted.

**Integrity conclusion and attribution finding:** the additions are contextually attributable to the prior Phase 3 rehearsal extension documented in the worktree, but the exact edit event/actor is not established by Git. The current worktree file is **not safe to present as an immutable historical baseline**. The committed seven-function `HEAD` blob is the only version with committed provenance; the nine-function worktree version is an uncommitted rehearsal extension. Preserve both as distinct historical facts. Do not reset, restore, stage, rewrite, regenerate, or silently treat the nine-row version as the original pin. Resolve which comparison set the operator is accepting in a separate decision.

## 2. Operator acceptance package

### A. Hosted provenance acceptance

**Project inspected in Phase 5B:** Supabase Staging ref `juwyhslzchjevqkdvwjm`, display name `autodinetest`, region `ap-northeast-2`, reported PostgreSQL `17.11`. Phase 5B used catalog-only reads; this Phase 5D review made no hosted connection.

**Baseline scope caveat:** Phase 5B reports a 0/9 hosted body-hash match, eight of nine ACLs matching, and all nine search paths matching. That comparison used the nine-entry worktree JSON. The committed `HEAD` snapshot has seven entries; those seven common signatures also have differing hosted body MD5s in the Phase 5B comparison table. The two added entries must not be called part of the original committed pin without operator acceptance of the extended rehearsal baseline.

| Function | Phase 5B semantic classification | Proposed treatment |
|---|---|---|
| `begin_online_payment(text,text,text,uuid,uuid,bigint)` | Material gap: hosted code does not serialize the existing attempt row for reuse, validate all reuse attributes, or refuse a distinct second pending intent for the same order. | Include final body from `20261110000900_online_payment_attempt_uniqueness.sql`. |
| `settle_online_payment(text,text,text,bigint)` | Highest financial risk: hosted code does not require the order to remain pending or the attempt amount to equal the current due balance before recording. | Include final body from `20261110000900`; keep stale attempts pending and fail closed. |
| `record_counter_payment(text,uuid,text,bigint,uuid)` | Materially aligned: correct tenant/role checks, session→order locks, pending-online guard, exact balance, idempotency, and audit. | Do not replace for hash normalization. |
| `cancel_order(uuid,uuid,text)` | Materially aligned: session→order lock, guest-token privacy, staff authorization, pending/paid/prep guards, repeat-cancel behavior, and guest time limit. | Do not replace. |
| `set_order_line_quantities(uuid,jsonb,uuid)` | Materially aligned: authorization, state guards, bounded line validation, zero-quantity deletion, and tax-snapshot recomputation. | Do not replace. |
| `close_order_session_and_issue_receipt(uuid)` | Hosted outstanding-balance guard is already materially equivalent to the candidate. | Do not replace to chase a body hash. |
| `place_public_order(text,jsonb,text,text,uuid,text)` | Order-admission gap: hosted body lacks successful-order limits of 30/session and 60/restaurant per ten minutes plus optional restaurant-scoped IP cap; the attempt wrapper's limits are separate. | Include only this function body from `20261110000300_shared_wifi_scan_limits.sql`. |
| `open_table_session(text,text)` | Materially aligned: QR lock, scan/code handling, 10/card/hour and 20/card+IP/hour, and five-column app contract. | Do not replace; it is already compatible. |
| `operational_schema_readiness()` | Compatible but deliberately narrow; it checks five probes and does not attest all function bodies, online-payment setup, QR compatibility, or recovery. | Do not replace to normalize its hash. |

**Historical `20261109000400_order_write_boundary.sql` source-byte explanation:** Phase 5B found manifest SHA-256 `891b6dd75e69d794437340b4d3c60904193a092cf7503868dd629e92f8759d0c`, matching the 2,478-byte older source at GitHub commit `14a9391ef29e5c35323d3676f5e2844a5935b32b` and the corresponding source block in the older `scripts/staging/approved-upgrade.sql` (after excluding the builder's extra newline). The current canonical file SHA-256 is `e604a331a3f0e71850ecb93cc2fdc4266c001773de0af921cc9bd4e8aeead650`, matching later commit `cbc4fcb4413b9370a8918af56d336bef19af8dab`; that revision changes the retired `place_order` overload-revoke logic, not the function bodies. This is strong source-level corroboration, **not an independent execution receipt**: the hosted manifest/ledger records names and hashes, not executed SQL bytes. Only one of the seven Phase 5B candidate filenames appeared in the 49-row historical manifest; do not replay that old bundle or rewrite history.

**Legacy `place_public_order` ACL:** Phase 5B's pinned expectation is `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`; hosted Staging was `{postgres=X/postgres,service_role=X/postgres}`. Retain `PUBLIC`, `anon`, and `authenticated` EXECUTE revocations. The shipped checkout uses `place_public_order_attempt(...)`; do not restore the broader legacy grants. The attempt wrapper remains the client entry point. No ACL change is proposed here.

**Outstanding provenance limitation:** operator acceptance must cover both (1) the historical source-byte explanation and residual lack of an independent executed-SQL receipt, and (2) whether the seven-row committed baseline or nine-row rehearsal extension is the comparison set being accepted. No such acceptance has been supplied.

### B. Staging recovery evidence — required, not supplied

No operator-owned Staging backup/PITR record or restore verification has been provided or independently verified. The earlier local cold-recovery exercise and Phase 5C synthetic replays are not hosted recovery evidence. No restore was initiated, and no request was sent.

| Required evidence | Operator must supply | Current status |
|---|---|---|
| Identity | Exact ref `juwyhslzchjevqkdvwjm`, project `autodinetest`, region `ap-northeast-2`; evidence record/reference. | Phase 5B project identity recorded; no recovery evidence. |
| Backup/PITR method | Provider method and independent operation/ticket/export reference; responsible operator. | Not supplied. |
| Recovery point | Exact UTC snapshot/PITR point, earliest/latest recoverable UTC timestamps, retention window, expiry. | Not supplied. |
| Restore verification | UTC time, isolated restore target/ref, outcome, metadata-level schema/catalog and integrity checks; any approved row-count/checksum method without row data. | Not supplied; no restore performed. |
| Scope/exclusions | Database schema/data in scope; explicit Auth, Storage, external services, and other exclusions. | Not supplied. |
| Clock assurance | Authoritative provider time source, synchronization status, check time, and measured offset. | Not supplied. Phase 5C sandbox date disagreed with Arena's date; this is not evidence about the provider clock. |

Do not attach customer rows, payment data, credentials, API keys, or secrets. Operator evidence must be independently reviewable metadata.

### C. Proposed technical change — proposal only

Phase 5C locally validated the exact candidate source hashes (`20261110000300`: `0b8092fb4ec7dfd442866bc8b802b031edc99a2b6a465ba4972ffd10f45882c2`; `20261110000900`: `624a9712333108610cd290226fd0a95b0dd21675aeaee121780574393aa977e8`). On disposable PostgreSQL 17.11 it passed clean and synthetic-Staging-scaffold 65-migration replays, 56/56 DB tests on each replay, and an additional 40-client order-cap concurrency check. This is local evidence only; no test is being repeated here.

The future minimal additive migration should contain only:

1. `place_public_order(...)` from `20261110000300_shared_wifi_scan_limits.sql`;
2. `begin_online_payment(...)` and `settle_online_payment(...)` from `20261110000900_online_payment_attempt_uniqueness.sql`.

Do **not** include the `open_table_session(...)` replacement, unrelated migrations, schema/table/index/trigger/constraint changes, grant/revoke changes, or the old 49-source artifact. Preserve exact signatures, owner, `SECURITY DEFINER`, `search_path`, and existing ACLs. Keep the legacy RPC client-revoked and continue using the attempt wrapper. Keep online payments disabled: Phase 5B found no live application UI/API flow, and these database checks do not authorize a provider flow.

**Extraction and contamination checks (not performed as an artifact build):** after all governance gates and an explicit request to prepare the artifact, extract each function by its exact signature and matching dollar-quoted function terminator—not by copying a whole candidate file. Whitelist exactly the three signatures above. The 00300 file also replaces `open_table_session`; exclude that entire definition. The 00900 source contains the two needed definitions and their function comments; only those comments may be retained. Inspect the final statement inventory and diff to require three `CREATE OR REPLACE FUNCTION` statements (plus at most the two matching `COMMENT ON FUNCTION` statements), and zero other function replacements, table/column/constraint/index/trigger DDL, grants, revokes, or privilege changes. Hash the resulting proposal and have it independently reviewed before seeking migration approval. No executable migration has been created by Phase 5D.

**Required post-migration catalog comparison if separately approved:** capture before/after identity arguments/signatures, return types, owners, language, `SECURITY DEFINER`, `proconfig`/search paths, function definitions/fingerprints, ACLs and effective `EXECUTE` for `PUBLIC`, `anon`, `authenticated`, `service_role`, and `postgres`. Confirm the attempt wrapper signature/grants are unchanged; direct client EXECUTE on legacy `place_public_order` remains denied; payment functions remain service-role-only; and `open_table_session` is unchanged. Compare required table columns plus relevant constraints, indexes, triggers, and grants for unexpected drift. Use catalog-only results and preserve the output with the approved artifact hash; do not query customer rows or use a readiness boolean as a substitute for this comparison.

### D. Explicit operator decisions — all pending

| Decision | Operator response | Evidence/record |
|---|---|---|
| Accept/reject the nine-function semantic classification and historical `20261109000400` source-byte explanation, including the missing independent execution receipt. | **Pending — not supplied.** | Operator to complete. |
| Confirm the authoritative baseline set: committed seven-row Phase 3 snapshot, or the uncommitted nine-row rehearsal extension; do not edit the baseline to record this decision. | **Pending — not supplied.** | Operator to complete. |
| Confirm the Staging backup/PITR and isolated restore evidence is complete and acceptable. | **Pending — no evidence supplied.** | Attach metadata-only evidence reference. |
| Approve, reject, or defer a future minimal migration for Staging only, after reviewing the exact artifact SHA-256. This is not Production approval. | **Not approved; artifact not prepared.** | Artifact hash, exact scope, and approval window must be supplied if approved. |
| Identify the responsible operator and approval timestamp in UTC. | **Not supplied.** | Operator to complete; do not infer. |

## 3. Final disposition and remaining risks

**NO-GO.** There is no current authorization to build or execute a hosted migration. The Phase 5B gates remain open: baseline/provenance acceptance, recovery evidence and restore verification, authoritative clock corroboration, and explicit Staging-only approval of an exact future artifact. The worktree baseline is not an immutable reference until its seven-versus-nine scope is resolved; preserve its exact bytes meanwhile.

This document is for Aryan to review and share manually. No message/request was sent, no connector or hosted system was used, no database tests were repeated, no baseline bytes were changed, nothing was staged, and no commit was created.
