# Local populated logical-restore rehearsal

Scope: synthetic data on a disposable embedded PostgreSQL 17 cluster, on this branch. This is **not** a hosted B2 download, a custom-format `pg_dump`/`pg_restore` rehearsal, a Supabase Auth/Storage restore, or production recovery evidence. The hosted workflow still requires a real owner-approved dispatch after the branch's scaffold fix is merged to the default branch. Launch remains **NO-GO** under `MASTER_BLOCKER_REGISTER.md`.

## Reproduced defects and changes

- A public-schema Mode B backup of the fully migrated source failed when restored to bare PostgreSQL: `schema "auth" does not exist`. A synthetic local Supabase scaffold made this sample restorable. The hosted `postgres:17` workflow now invokes the same loopback-only initializer as the local test; a hosted archive may have additional platform/extension/role dependencies, so its success is not assumed.
- A seeded restore initially matched the manifest's row counts and financial totals but failed row checksums: JavaScript `Date` conversion truncated timestamp microseconds. The logical exporter now obtains each value as PostgreSQL text, avoiding JavaScript timestamp and JSON-number conversion; the rehearsal covers a six-digit timestamp, large JSON integer, high-precision numeric, bytea, array, and escaped text.
- The restore-target guard now rejects URL query overrides of host, hostaddr, user, or service. Such options can otherwise change the actual node-postgres/libpq target after a loopback or project-ref decision.

## Two independent runs

Command: `npm run test:db:logical-restore` (the runner creates and destroys its own cluster and backup material). Each run replayed 102 migrations and seeded a local fixture, including one additional synthetic round-trip test table. Both compared public-table row fingerprints, policies, function signatures/ACLs, manifest counts and financial sums. They verified a valid encrypted artifact, rejected a bare unscaffolded target, unsafe target, target-host override, tampered artifact, wrong passphrase, and a deliberately changed restored payment. Both emitted `LOCAL_LOGICAL_RESTORE_CLEANUP_VERIFIED` after server shutdown and deletion of the scratch directory.

| Run | Tables | Rows | Policies | Functions | Payments sum (paise) | Subscription sum (paise) | Restore command only | Encrypted artifact SHA-256 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 49 | 10 | 59 | 164 | 12,345 | 49,900 | 387 ms | `220a979bde492f4cec3a74914257c8d7079784f3eb46c3b3687f23f6bad3a84b` |
| 2 | 49 | 10 | 59 | 164 | 12,345 | 49,900 | 379 ms | `34b819fe84cd0348533b5f6a73ef622dac152febbdfee1f2aac34a6e7bea7bb2` |

A subsequent full `npm run verify:local-gates` sweep passed **17/17**; the DR suite passed **157/157**, and the staging guards passed **66/66**. The blocker-register and Phase 7 evidence guards were also run separately after the documentation updates.

Encrypted artifact digests vary because encryption and synthetic fixture data use fresh randomness. The artifact files were intentionally deleted; these digests are run observations, not retrievable hosted evidence. Restore-command duration excludes setup, backup, transfer, verification and cleanup, and is **not** end-to-end RTO. Fingerprints do not compare all function bodies, extensions, grants, or platform data. The local Mode B rehearsal cannot establish hosted Mode A compatibility or an RPO/RTO objective.

## Remaining integration and owner work

- Six hosted backup secrets, B2 provisioning and hosted workflow dispatches remain owner-controlled; inability to read secret names is **UNKNOWN**, not proof of absence. No hosted manifest or restore report is filed in the blocker register.
- PR #181's proposed migration `20261112000200_owner_billing_configuration_guard.sql` collides with this branch's `20261112000200_immutable_restaurant_account_link.sql`; reconcile the version and behavior before integration.
- PR #184 remains draft. Both `docs/edge-security-runbook.md` and `docs/infrastructure-architecture.md` exist on this branch and differ from its head; reconcile content before integration, rather than replacing either copy blindly.
