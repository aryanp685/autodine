# Incident runbooks — outage, failed payment, IRP failure, realtime degradation, escalation

**Prepared in P6 (2026-11-19) for the local release candidate.** Every command
here is local or read-only unless an owner authorization names the exact
target and action. Nothing in this file was executed against a hosted
project, and running a step here is not approval to run it in Production.

Companion documents: [safe verification and release runbook](../OPERATIONS-READINESS.md),
[backup and restore](../backup-restore-runbook.md),
[PITR verification](../pitr-verification-procedure-2026-11-14.md),
[monitoring readiness](../monitoring-readiness-2026-11-14.md),
[email runbook](BREVO_EMAIL_RUNBOOK.md).

---

## 0. Shared rules

1. **Fail closed.** If a write cannot be proven to have committed, do not
   retry it blindly; read the recorded state first. Every workflow below has a
   read step before the retry step.
2. **Never invent a legal identifier.** No operator, script or support action
   generates, types or "corrects" an IRN, e-way bill number or GST document
   number outside the recorded database path.
3. **Two-person rule for money and tax.** Any correction that changes an
   amount, a document number, or an IRP state needs a second person to read the
   evidence before it is recorded.
4. **Record what you saw.** Write timestamp (UTC), outlet, order/sitting id,
   the query or screen, and the outcome into the incident note. Screenshots are
   evidence only when they show the id.
5. **Escalate before you improvise** (§5).

---

## 1. Database or platform outage

**Symptoms:** staff screens show an error boundary or a failed save; guest
ordering stalls at the confirmation step; `next build` health checks fail.

| Step | Action |
|---|---|
| 1 | Confirm blast radius: is one outlet, one device or everything failing? Try a second device on the same LAN with mobile data off. |
| 2 | Read-only probe: `select now(), clock_timestamp();` against the target. A timeout is an outage, not a slow save. |
| 3 | Stop retrying writes on the affected device. Note the exact last successful action (order placed / payment recorded / receipt issued). |
| 4 | If the failure is DNS/TLS, capture the error text once, then stop testing; repeated failed auth attempts can trip rate limits. |
| 5 | Guest side: the order-status screen keeps polling with a widening backoff (2s → 60s, `lib/order-status-poller.ts`) and shows `reconnecting`; the guest does not need to re-order. Staff should tell the table the order is recorded and show the ticket if it exists. |
| 6 | When the service returns, reconcile before resuming: open the sitting, confirm the order and any payment row, and only then continue service. |
| 7 | If the database must be restored, follow [backup-restore-runbook.md](../backup-restore-runbook.md) — restore is a separate owner authorization, and a restore rehearsal is not a Production restore. |

**Do not:** re-run a checkout for an order that already exists (the guest
checkout wrapper replays the same request idempotently, but a second *sitting*
is a second sale), or "void" a document that was never committed.

---

## 2. Failed or disputed payment

Money is recorded per order at the counter; the bill is closed per sitting.
A failed payment is therefore always resolved against a specific order.

| Step | Action |
|---|---|
| 1 | Identify the order (table, time, amount) and open it from the cashier screen. |
| 2 | If the payment never committed, the order is still unpaid: re-record the correct method. Confirm the recorded row before closing the sitting. |
| 3 | If the payment committed but the guest says otherwise, read the recorded payment and the settlement row; do not record a second payment for the same order. |
| 4 | If the guest was charged twice (two payment rows for one order), record the correction as a credit note through the documented GST path, not by deleting rows. Deletion of financial rows is refused by design. |
| 5 | UPI: reconcile against the provider statement for that day; a UPI "pending" notification is not a recorded payment until the row exists. |
| 6 | Card/aggregator: no live aggregator is enabled in this release candidate. If one is enabled later, its settlement report — not the terminal screen — is the authority. |
| 7 | File the evidence: order id, payment rows, settlement row, and the reconciliation source. Escalate per §5 if the amount impacts a filed GST document. |

**Document rule:** an invoice with IRP evidence cannot be voided
(`void_restaurant_invoice` raises `Reconcile IRP evidence`); issue a credit
note instead. For a document whose IRP state is `pending`, resolve the IRP
state first (§3) and then correct.

---

## 3. IRP failure, lost response or provider outage

The IRP path in this release candidate is **simulation-only**. A production
deployment has no route, no credential and no provider adapter; the register
renders read-only and ordinary B2C billing is unaffected. The steps below
apply to a future authorized provider once one exists — the reads and the
lookup-before-resend rule are the same.

| Step | Action |
|---|---|
| 1 | Read the dispatch register: filter by issue date and choose **Follow-up only**. The row shows the phase and the last outcome. |
| 2 | **Lost or ambiguous response** (`uncertain`, or a claim that expired): use **Request lookup** — never a fresh generate. The worker reconciles the provider's record for that document. |
| 3 | Only when the lookup proves the document was not received may an operator queue a retry. The retry path is disabled while the outcome is still ambiguous (by design in `lib/gst/irp/execution/worker.ts` and the register). |
| 4 | **Hold**: a held document keeps a legal hold; releasing it is an owner-only action recorded in the dispatch events (`owner_lookup`, `owner_cancel`, `confirmed_active`). |
| 5 | **Cancellation**: allowed only inside the provider's cancellation window (`canCancelAt`), requires a reason from the approved list, and is confirmed by a verified provider answer. A cancellation that the provider refuses stays recorded as refused — it is not retried silently. |
| 6 | After any action, verify the document: `irp_status`, the evidence text, and the invoice's `irn` (null until a verified accept). Never show a simulated reference as an IRN. |
| 7 | If the provider is down, leave documents queued; the worker sweeps leases and backoff. Do not bypass the queue or hand-edit `irp_dispatches`. |
| 8 | Reconciliation: export the dispatch CSV for the affected date range, compare with the provider portal, and record the differences in the incident note. |

Local rehearsal commands (disposable database only):

```sh
npm run test:e2e:irp          # 2 browser journeys against the synthetic provider
npx vitest run lib/gst         # worker/provider/verification unit matrices
```

---

## 4. Realtime degradation

**Symptoms:** the floor screen stops updating; guests see a stale status;
no error is shown.

| Step | Action |
|---|---|
| 1 | Distinguish transport from data: reload the page once. A reload that shows the new state means the realtime channel degraded, not the database. |
| 2 | Staff floor: the outlet revision is metadata-only; a manual refresh is always safe and is the documented fallback. Do not ask staff to poll by repeatedly tapping actions. |
| 3 | Guest status: the poller backs off (2s, 5s, 10s, 20s, 30s, 60s) and resumes on visibility change; the guest needs no action. A `stopped` phase means the order reached a terminal state or the link is no longer valid. |
| 4 | If realtime is down for the whole venue, tell staff to refresh before each table action and to confirm the ticket after every write. Record the window (start/end UTC). |
| 5 | After recovery, reconcile the affected sittings: orders, payments and documents, in that order. |
| 6 | If the `supabase_realtime` publication is missing the app's tables (an authorization step for a hosted target), that is a deployment defect, not an incident to fix by hand; escalate. |

---

## 5. Escalation ladder

| Severity | Examples | First responder | Escalate to | Target |
|---|---|---|---|---|
| S1 | Data loss or corruption, wrong money recorded, a tax document that cannot be reconciled, Production down | Duty operator | Owner + engineer on call | Acknowledge 15 min, containment 1 h |
| S2 | One outlet cannot take orders or payments; IRP queue stalled > 1 h; realtime down venue-wide | Duty operator | Owner | Acknowledge 30 min, workaround 2 h |
| S3 | Single device, single guest link, cosmetic or report-only issue | Duty operator | Owner (next business day) | 1 business day |

Rules: one incident owner at a time; a written timeline in UTC; no direct
database edits during an incident except a read; any corrective write is
recorded as an ordinary application action so it stays auditable. Contact
numbers and the on-call rotation are owner-held and deliberately not in this
repository — see
[MASTER_OWNER_ACTION_REGISTER](../../qa-evidence/day1/MASTER_OWNER_ACTION_REGISTER.md).

**Post-incident:** within two business days, record root cause, the exact
documents/orders affected, the correction path used, and a regression test if
the incident exposed a code defect.
