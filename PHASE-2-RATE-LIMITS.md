# Phase 2 — shared Wi-Fi and rate-limit correctness (in progress)

## Implemented locally

Migration `20261110000300_shared_wifi_scan_limits.sql` makes two bounded changes:

1. Scan admission locks the resolved QR row before counting/minting. Concurrent
   scans can no longer independently observe spare capacity and overshoot the
   ten successful opens per card per hour ceiling.
2. Scan IP counting is scoped to the QR card, not globally across tables and
   restaurants. Order IP keys are scoped to the restaurant. An address/hash is
   not an authenticated person, particularly on restaurant Wi-Fi/carrier NAT.

No numerical thresholds, verification modes, token lifetimes, role grants,
order idempotency, financial RPCs or existing data are changed. Phase 1 financial
and recovery regressions continue to run with these changes.

## Limits, explicitly

- Scan: 10 successful opens per card/hour remains the governing ceiling. The
  supplementary 20/card-IP/hour check remains but is redundant under that cap.
  Shared Wi-Fi can now use independent cards without a global 20/IP bottleneck.
- Order: 30/session and 60/restaurant per ten minutes remain. Supplementary
  60/restaurant-IP uses a new tenant-scoped key. It is redundant while the
  restaurant cap is 60. More than 60 legitimate orders/ten minutes can still
  be refused; this work is not a capacity increase or launch certification.
- Scope change intentionally removes the old cross-card/cross-tenant IP brake.
  An attacker targeting many cards now gets each card's bounded allowance;
  network-wide protections need trusted edge identity/policy, not optional
  client-supplied hash strings. Do not describe this as stronger global abuse
  prevention. Per-card, per-session and per-restaurant limits remain in place.
- Old order IP keys are not migrated; the supplementary tenant-IP window starts
  fresh after deployment. Existing restaurant/session counters remain active.
- Order RPC exceptions roll back in-transaction limiter increments. Therefore
  these counters are not durable failed-request/attempt budgets. No claim that
  malformed/rejected requests consume a persistent attempt budget is made.
- Raising a cap, accepting arbitrary IP headers, or treating caller-supplied
  p_ip_hash as trusted identity is not part of this fix.

## Regression evidence

New native tests:

- 24 guests across three cards in one restaurant, with one shared address:
  all admitted while each card stays below its individual ceiling.
- 16 concurrent scan clients against a card with one prior open: exactly nine
  more sessions minted, seven refusals with null tokens, and exactly ten open
  logs and verification sessions. Test resolves the actual scanned card rather
  than accidentally choosing a separately auto-provisioned QR row.
- Saturated tenant-A IP budget refuses A but does not stop tenant B sharing the
  same address; refused A creates no extra order.

Omitting the migration reproduces all three new failures. The old global IP
counter also causes downstream fixture failures because fixtures intentionally
share one address, further exposing cross-tenant coupling.

Latest PostgreSQL 18.6 run: **38 native tests passed**, including populated
financial-upgrade fingerprint checks. Ordinary suite: **1946 passed / 38 skipped**;
those database tests are executed separately, not counted as ordinary passes.
Typecheck, lint, design guard, production build and whitespace checks passed.

## Remaining Phase 2 gates

- Code-verification attempt counters and scan-confirm paths need their own
  shared-network/concurrency review; this change targets open_table_session
  and the latest place_public_order wrapper only.
- Review IP-header trust/deployment topology and durable failed-attempt budgets
  before proposing any new coarse network-wide enforcement.
- Boundary expiry, cross-version CI, hosted staging verification and peak/soak
  testing remain pending. Phase 3 hosted load work is not started.
- No hosted migration, commit, push, merge, production data change or paid
  resource was performed. Deploy only after review/CI and explicit approval.

## Follow-up — verification, expiry and header-contract review

Added native regressions (no additional SQL policy change needed):

- Twelve simultaneous wrong-code verifications for the same QR/IP produce five
  `wrong` and seven `limited` responses. All return null session tokens, and
  the committed attempt row remains at five with a future block timestamp.
- After the block/window expires, a correct code succeeds. Success clears the
  per-card/IP failure row, allowing a second legitimate guest on that Wi-Fi to
  verify rather than counting successful guests against failed-code attempts.
- Ten scan opens hit the existing cap; ageing logs to the hour boundary permits
  a new open. Expired verification tokens still cannot create a new order.
- Scan-confirm still stamps a held ticket; another tenant cannot confirm it,
  while authorized staff can. The shared-network change does not auto-confirm
  guests or claim proof of physical presence.

IP header review: addressFromHeaders currently takes the first X-Forwarded-For
hop, falls back to X-Real-IP, then `unknown`. Added unit tests pinning extraction,
server-action hashing and per-salt hash separation. This is a documented contract,
not evidence that a production proxy strips spoofed headers. Deployment-specific
header provenance has NOT been verified and no trust-model rewrite was made.
Direct RPC callers can still supply arbitrary hashes, and order hashes are
optional. Card/session/tenant database limits, not an IP fingerprint, remain the
primary admitted-work boundaries. Changing this needs trusted edge enforcement
and a separate reviewed deployment plan; fake browser identity is not a fix.

Results: PostgreSQL 18.6 **41 native tests passed**, including Phase 1 financial
regressions and the populated-upgrade check. Ordinary unit suite **1950 passed,
41 skipped** (database tests run separately). Typecheck, lint, design guard,
production build and diff checks pass. The original three new Phase 2 tests
still fail when the migration is omitted; new existing-behavior guards pass.

This supersedes the earlier code-counter/scan-confirm review and tested expiry
gaps. Cross-version CI, production proxy provenance, and durable failed-order
attempt budgets remain unverified/open. No new threshold, code-security-policy
loosening, hosted migration, commit or merge was performed in this follow-up.

## Follow-up — order quota abuse invariants and cross-version runs

Added native tests proving:

- At the per-session ceiling, omitting or changing the optional IP hash cannot
  admit a new order. A matching idempotency retry still returns the existing
  order code without consuming quota. After the session window expires, a new
  order is admitted again.
- At the restaurant ceiling, fresh verification sessions and different/omitted
  IP hashes cannot admit additional orders. Refusals leave order count unchanged.

Local populated-upgrade + native verification now passes on PostgreSQL 15.19,
17.11 and 18.6: **43 tests passed per version**, including financial regressions.
Each run checks data/security preservation across the Phase 1/2 migrations.
PostgreSQL servers were disposable, loopback-only, and stopped after validation.
Full ordinary suite: **1950 passed / 43 database tests skipped**, executed
separately above. Typecheck, lint, design guard, production build and whitespace
checks pass. No app dependency or package-lock changes were made.

### Abuse-budget conclusion / remaining decision

The current SQL order limiter bounds successful work, not durable failed HTTP
attempts: raising an SQL error rolls back counter increments in that transaction.
Increasing caps or merely adding another hit_rate_limit call inside the same
failing RPC does not fix that. Do not claim brute-force or malformed-request
attempt protection based on these successful-order counters.

A durable failed-order budget requires a separately committed reservation and
an explicit direct-RPC policy (for example, trusted-server admission with direct
anonymous ordering access removed, or a versioned status-returning database API
that persists refusals instead of raising). Either changes public access/API
semantics and needs a reviewed compatibility/security plan before implementation.
No such policy change was silently bundled into the shared-Wi-Fi migration.

Cross-version *local* evidence is complete for these tests. GitHub CI has not
run for this branch; production proxy trust, durable failed-order budget design,
hosted staging validation and independent review remain open. Phase 3 load tests
have not started. No commit, push, merge or hosted migration performed.

## Versioned durable order admission — implemented locally

The separately committed-reservation design discussion above is superseded for
valid-session order RPC work by a status-returning API:

- `place_public_order_attempt` returns JSON `{code,error}`. It resolves a live
  table session for the requested tenant, checks matching idempotency retries,
  then reserves **60 attempts/session/600s** and **120 attempts/tenant/600s**.
  These are explicit new attempt-policy defaults, not increased successful-order
  capacity. Existing 30/session and 60/tenant success caps remain unchanged.
- Order work runs in an inner PL/pgSQL exception block. A failure rolls that
  work back, but returns structured error data instead of aborting the outer
  transaction, so the reserved attempt counters commit. SQL/PostgREST transport
  failures or client-initiated transaction rollback cannot be counted this way.
- App checkout uses this new API and validates the envelope. It retains existing
  guest error mapping and bounded transient retries. Malformed/missing envelopes
  fail closed; no silent legacy fallback bypasses admission.
- Anonymous/authenticated EXECUTE on the old six-argument order RPC is revoked.
  It remains an internal definer implementation; the new entrypoint is granted
  to those roles. Operational readiness now probes the versioned entrypoint.
- The Phase 1 fingerprint drill checks at the boundary *before* Phase 2 begins:
  Phase 2 intentionally changes the public API ACL and readiness implementation,
  so calling those ACL changes a Phase 1 preservation failure would be false.

Native tests verify 60 malformed-order failures persist their admission count,
the next valid order is rate-limited, no failed order is written, old entrypoint
privileges/actual staff invocation are denied, and successful idempotency replays
remain quota-free. Decoder and action/flow tests cover the new response contract.
PostgreSQL 15/17/18 local runs: **45 native tests passed per version**. Full unit
suite: **1953 passed / 45 database tests skipped there**, executed separately.
Typecheck, lint, design guard, production build and diff checks pass.

### Coverage and rollout constraints — do not skip

This protects order work submitted with a valid verification session. It is NOT
an HTTP request limiter: invalid/expired credentials, oversized JSON rejected by
transport, and action-level parsing failures need trusted edge/request protection.
Optional IP headers are still not trusted identities. Requests with new sessions
share the tenant attempt ceiling, but invalid-session queries are not durably
counted. Successful retries require a currently live session in this version.

Migration 004 is a breaking public-API cutover. Applying it while old app builds
still serve checkout will deny their old RPC; deploying the new app before the
migration will find its new RPC absent. Do not apply it to a hosted database
without a coordinated maintenance/cutover or a reviewed expand/contract rollout,
and handle still-served preview/rollback builds. This is a release gate, not a
claim of zero-downtime compatibility. No legacy bypass fallback should be added
merely to make an uncoordinated deployment appear successful.

GitHub CI, independent review, hosted PostgREST transaction behavior (including
any Prefer: tx=rollback configuration), and production proxy provenance remain
unverified. No commit, merge, deployment or hosted database change performed.

## Follow-up — anonymous concurrency and release procedure

Added native checks with real `SET ROLE anon` connections:

- Sixteen parallel malformed requests starting at 50 session attempts yield ten
  processed failures and six rate refusals; the committed session counter is
  66 and the tenant counter is ten. No extra order is written.
- A saturated tenant attempt window rejects new verification sessions; advancing
  the window permits a real authenticated caller to order again.
- Wrong-tenant and expired credentials return structured failures before
  admission; no order or tenant-attempt row is created.

Updated local native suites: **48 passed per PostgreSQL 15/17/18 version**.
Full ordinary suite: **1953 passed / 48 database tests skipped there**, run
separately. Typecheck, lint, design guard, build and diff checks passed.

PHASE-2-ROLLOUT.md now specifies review/CI gates, target isolation, HTTP
transaction checks, maintenance/drain requirements, exact app/schema cutover,
post-cutover checks and coordinated rollback constraints. It is a proposal,
not evidence of execution or permission to operate on a hosted target.
No commit, push, merge, hosted migration or deployment performed.
