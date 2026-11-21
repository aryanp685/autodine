# Arena A — staging B2 disaster-recovery rehearsal

Sanitized execution evidence. No database URI, password, passphrase, B2 key, token, customer data, provider response body, or credential length is recorded here.

## Final verdict: BLOCKED

The real hosted B2 rehearsal did **not** start. The protected `backup-staging` Environment supplied a non-empty passphrase that failed the authoritative minimum contract in three fresh runs, including twice after owner confirmation and once after owner-confirmed deletion/recreation of the Environment secret.

The passphrase gate runs before B2 authorization, source authentication, backup, upload, download, or restore. Therefore no B2 object was created and no staging database connection was opened by these runs.

## Audited code and pull request

| Item | Result |
|---|---|
| PR | [#194](https://github.com/aryanp685/autodine/pull/194) |
| Audited head | `093f0814fb0c8ae40299ee9e42e3d8d6cb80b7a7` |
| PR state at evidence capture | OPEN, CLEAN, MERGEABLE, unmerged |
| Changed-file inventory | 119 files |
| Exact-code manifest | PASS — 53 pinned files, byte for byte |
| Environment-scope attestation | Owner explicitly attested six secrets and three variables are Environment-only with no repository-level shadows; API metadata listing remains HTTP 403 |

Required hardening ancestry is present:

- `add8df23f1b46d9ec66e13e8c314c12f5bf5af5b`
- `9a06cfb82cd1ea845ace4be45697962caf9242ff`
- `26d236e34ae54e248f5215f315c2fd4b17c5ef4e`
- `fe074f6513cd56361fcf70ea4b4d561c7e5bce90`

The final implementation also contains `e116a5b533f7496975ec06fbd4c2b868cd90346e` via helper merge `093f0814fb0c8ae40299ee9e42e3d8d6cb80b7a7`. It independently proves the disposable PostgreSQL target and B2 bucket/key scope before use, records owner scope attestation, performs sanitized source identity checks, and captures separate DR timings when the credential gates pass.

## Runs

| Run | Exact-code | Safe preflights | Outcome |
|---|---|---|---|
| [44810230258](https://github.com/aryanp685/autodine/actions/runs/44810230258) | REFUSED | not started | Default-branch registration still pinned the earlier implementation; no credentials materialized. |
| [44812396871](https://github.com/aryanp685/autodine/actions/runs/44812396871) | PASS | Disposable PG17, configuration presence and source/bucket designation PASS | Passphrase contract FAIL; no source/B2 access. |
| [44812887667](https://github.com/aryanp685/autodine/actions/runs/44812887667) | PASS | Same preflights PASS | Passphrase contract FAIL after first owner re-save; no source/B2 access. |
| [44879670508](https://github.com/aryanp685/autodine/actions/runs/44879670508) | PASS | Same preflights PASS | Passphrase contract FAIL after owner-confirmed delete/recreate; no source/B2 access. |

The Environment presence gate proves the passphrase secret is non-empty. The next step imports `passphraseProblem()` from `lib-crypto.mjs`; failure means the effective Environment value does not satisfy `MIN_PASSPHRASE_LENGTH`. No value or length was emitted.

## Acceptance matrix

| Requirement | Status | Evidence |
|---|---|---|
| Normal main/PR ancestry | PASS | `main` is the merge base of the reconciled PR branch; no unrelated-history operation used |
| Required hardening commits | PASS | full SHA ancestry above |
| Exact audited code | PASS | gate passed on `093f081…` |
| Six secrets + three variables available | PASS (presence) | protected Environment preflight |
| Environment-only scope | OWNER-ATTESTED | explicit owner attestation input; API inspection still 403 |
| Disposable PostgreSQL 17 target | PASS | ephemeral Actions service container, loopback endpoint, empty `drill` database |
| Source and bucket configured designation | PASS | staging validator |
| Passphrase contract | **FAIL** | three fresh hosted runs |
| B2 key restricted to bucket ID `d209a0cc2db8f17fac100514` | BLOCKED | step intentionally follows passphrase gate and did not run |
| PostgreSQL 17 staging authentication and read-only identity | BLOCKED | step intentionally follows passphrase gate and did not run |
| Backup/archive validation/encryption | BLOCKED | not started |
| B2 upload and metadata verification | BLOCKED | not started |
| Download and SHA-256/manifest verification | BLOCKED | not started |
| Isolated restore and schema/data/invariant verification | BLOCKED | not started |
| Real backup/upload/download/restore timings | NOT MEASURABLE | no backup started |
| Measured RPO/RTO | NOT MEASURABLE | no recovery run completed |
| PR #194 merge | BLOCKED | real B2 rehearsal has not passed |

## Local and pull-request checks

- `npm run test:dr`: 241/241 tests passed.
- `npm run test:staging:guards`: 66/66 tests passed.
- TypeScript and ESLint passed.
- Hermetic CI-mode production build passed.
- `verify:release`: 28 checks passed (not release authorization).
- PR checks on audited head: CI, PostgreSQL 15/17/18 migration boundaries, browser E2E, throttle E2E, Edge TTS and Vercel Preview checks passed.

## Security and side-effect confirmation

- No production database or B2 resource was accessed or modified.
- No staging source database connection was opened by the three final runs.
- No B2 authorization, listing, read, write, upload, or download occurred in those runs.
- No existing B2 object, version, bucket, or key was deleted, pruned, rotated, or modified.
- No database password was reset and no credential was guessed.
- During the rehearsal executions, no production deployment was initiated by the agent and PR #194 remained unmerged. Afterward, the owner independently force-pushed `main`; Vercel production status could not be verified because the connected Vercel token returned access denied.

## Subsequent live repository state

After the evidence-only follow-up checks passed, owner `aryanp685` independently closed PR #194 at `2026-11-21T07:25:25Z` and force-pushed `main` one second later. Live `main` became `89fa6848bcb90d0a1b3dde138ed0d9f1acc1343a`, a new two-commit history that does not contain the audited rehearsal implementation. PR #194 is **CLOSED, UNMERGED** (`mergedAt: null`); no agent merge was attempted.

The sanitized evidence commit remains on the former PR branch at merge commit `8e9a7010a264229af6a0072e0cbf846ac5f5afb4`, but it is not on the force-pushed `main`.

## Acceptance gate preventing completion

The effective `backup-staging` Environment value for `STAGING_AUTODINE_BACKUP_PASSPHRASE` remains missing-or-short according to the authoritative code contract despite owner reports that it was replaced. GitHub does not expose the value and the API token cannot list secret metadata (HTTP 403), so the agent cannot correct or independently inspect it without violating secret-handling rules. Repeating unchanged dispatches is prohibited.
