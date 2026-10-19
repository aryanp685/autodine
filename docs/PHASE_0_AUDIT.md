# AutoDine — Phase 0 Repository Audit

**Phase:** 0 — Repository Audit (read-only)
**Status:** Complete (audit only — no application code created)
**Date:** 2026-10-18
**Repository:** `aryanp685/new` · branch `arena/62c92cc6-new` · base commit `eb3da2dbfeab0b4909a8f62edfb8fe1fd13e8bae`
**Product name:** AutoDine

---

## 1. Headline finding

**There is no existing application in this repository.** The repository contains exactly one file (`README.md`, contents: `# new`). There is no frontend, no backend, no database, no schema, no configuration, no tests, and no deployment setup — and none of these have ever existed in the repository's history.

Per the master plan (Rule 5): *"If no existing project is present, report that fact and ask for approval before creating the initial application structure."* This report therefore closes Phase 0 as an **empty-greenfield audit** and requests that approval in §9.

**Nothing in this phase modified, deleted, or built application code.**

---

## 2. Evidence

| Check | Command | Result |
|---|---|---|
| Tracked files | `git ls-files` | `README.md` (1 file total) |
| All files on disk (excl. `.git`) | `find . -type f` | `./README.md` |
| Files ever added in any commit | `git log --all --name-only --diff-filter=A` | `README.md` only |
| Commit history | `git log --all --oneline` | 1 commit: `eb3da2d Initial commit` (1 insertion) |
| Branches | `git branch -a` | `main`, `arena/62c92cc6-new` (no feature branches, no stale work) |
| Remotes | `git remote -v` | `origin → https://github.com/aryanp685/new.git` (auth works) |
| `.gitignore` | — | **absent** |
| `package.json` / any manifest | — | **absent** |
| Any source file (`.ts .tsx .js .jsx .py .go .sql .prisma`) | — | **none** |
| `.env` / secrets | — | **none present** (nothing to leak) |
| CI / deploy config | — | **none** |
| Repo size | `du -sh` | 116 KB, effectively all Git metadata |

**Conclusion:** greenfield. There is no legacy code to preserve, no migration risk, and also **no existing assets to reuse**.

---

## 3. Existing architecture

**None.** There is no stack to keep, extend, or migrate.

This has a direct consequence for the master plan's Phase 3 backend decision checkpoint: **"Option A — Keep and extend the existing backend" is not available**, because no backend exists. The real choice at Phase 6 will be between a self-built modular monolith and a managed backend platform. I will re-present this properly at Phase 6 with costs; I am not committing to anything now.

### 3.1 Environment available in this workspace (host capability, not yet committed to)

| Tool | Version | Notes |
|---|---|---|
| Node.js | v22.22.3 | Current LTS-line; sufficient for any modern JS framework |
| npm | 10.9.8 | Package install works (npm registry reachable) |
| Python | 3.11.2 | Available; useful later for OCR evaluation (PaddleOCR/Tesseract) |
| Git | 2.39.5 | Authenticated to GitHub |

No database server, no Redis, no Docker daemon, and no cloud CLI have been verified as present or usable. I have not installed anything.

---

## 4. Route and screen inventory

**Existing routes: none.** No router, no pages, no endpoints.

The full target inventory from the master plan (≈60 screens across public site, owner dashboard, customer, kitchen, cashier) is **entirely unbuilt**. It is carried forward as the Phase 1 screen inventory in §9 and will be used to scope the design prototypes. Nothing is reduced or dropped; only the *prototype depth* needs your decision.

---

## 5. Actual order / payment lifecycle

**Does not exist.** There is no order model, no payment path, no kitchen notification, no voice system, no receipt generation.

Reference lifecycles (Flowcharts C, D, E) are recorded as **specification only** — see `docs/FLOWCHARTS.md`. They describe intended behaviour, **not** implemented behaviour.

---

## 6. Database summary

**No database, no schema, no migrations, no ORM, no seed data.**

Data-model entities listed in the master plan Part 15 (users, restaurants, memberships, roles, menus, categories, items, variants, modifiers, imports, versions, themes, tables, QR codes, verification sessions, orders, order snapshots, payments, receipts, order events, announcement jobs, subscriptions, billing events, audit logs) are **all missing** and will be proposed at Phase 6 as part of the architecture proposal, not before.

---

## 7. Feature-by-feature status vs. specification

Legend: **M** Missing · **NV** Not verifiable (nothing to verify)

### Public website
| Requirement | Status |
|---|---|
| Home, Features, Pricing, Demo, FAQs | M |
| Sign up, Login, Contact/help | M |
| Privacy, Terms, Refund/cancellation, billing disclosures | M |

### Owner dashboard
| Requirement | Status |
|---|---|
| Dashboard overview, restaurant setup, profile | M |
| Menu list, menu editor, AI import, import review | M |
| Brand studio / theme customization | M |
| Menu preview and publishing (Draft → Review → Approve → Publish) | M |
| Tables & QR management (create, generate, preview, print, revoke, regenerate, disable) | M |
| Order history, kitchen/voice settings, payments & receipts | M |
| Sales reports, staff & permissions, subscription & billing, account/security | M |

### Customer interface
| Requirement | Status |
|---|---|
| QR landing + on-site verification | M |
| Rotating / short-lived code validation, revocation, expiry | M |
| Menu landing, category nav, search, item detail + customization | M |
| Cart, checkout, online payment states, counter-payment confirmation | M |
| Order confirmation, tracking, receipt access, invalid/expired QR state | M |

### Kitchen interface
| Requirement | Status |
|---|---|
| Order board (new / preparing / ready / served) | M |
| Unpaid-order indicator, voice settings, test announcement | M |
| Replay / missed-order recovery, connection & error states | M |

### Cashier interface
| Requirement | Status |
|---|---|
| Orders awaiting counter payment, order details | M |
| Record payment, payment confirmation, receipt generation/reprint | M |
| Corrections/refunds (pending your approval of scope) | M |
| Payment history and reconciliation | M |

### Subscriptions & billing
| Requirement | Status |
|---|---|
| Server-side 10-day trial (start/expiry timestamps) | M |
| Trial countdown + reminders | M |
| Post-trial read-only mode; block new orders; preserve data | M |
| Plan entitlements & server-side gating (₹899 / ₹1,599 / ₹2,699) | M |
| Live paid subscription, renewals, cancellation, webhooks (Stage 2) | M |

### Cross-cutting
| Requirement | Status |
|---|---|
| Auth, roles, tenant isolation, audit logs | M |
| Realtime delivery, idempotent webhooks, rate limiting | M |
| Backups, monitoring, tests, deployment config | M |
| Security headers, secret management, upload validation | M |

**Summary: 0 implemented · 0 partially working · 0 broken · 0 verified · ~55 missing.**

---

## 8. Security and reliability risks

**From existing code: none — there is no code.** No secrets, credentials, API keys, or customer data exist in the repository, so there is nothing currently exposed.

**Forward-looking risks** (recorded now so they are governed from the first line of code, not retrofitted):

| # | Risk | Why it matters | When it must be decided |
|---|---|---|---|
| R1 | Payment provider choice for India (customer orders) and, separately, for AutoDine subscriptions | Different products; recurring-payment eligibility, fees, webhook signing, settlement rules differ | Phase 6 (arch) / Phase 14 (billing) — **your approval required before activation** |
| R2 | Tenant isolation from day one | Every table must carry a restaurant scope; retrofitting row-level isolation later is expensive and error-prone | Phase 6 data model |
| R3 | Server-side price/total authority | Order totals must never originate from the browser | Phase 9 |
| R4 | QR / on-site verification strength | A static QR cannot prove physical presence; rotating codes reduce remote abuse but do not eliminate it | Phase 8 design — I will present the lifecycle for approval |
| R5 | Server-authoritative trial/subscription state | Frontend gating alone is trivially bypassed | Phase 14 |
| R6 | Upload/OCR resource exhaustion & unsafe files | File type, size, page count, and processing-time limits needed | Phase 12 |
| R7 | Secrets in client bundles | Only publishable keys may reach the browser | Phase 6 onward |
| R8 | No `.gitignore` yet | Risk of committing `.env`, `node_modules`, build output | Immediate — will add with the first real code |
| R9 | Audio/announcement durability | Announcement failure must never lose an order | Phase 10 |

No risk above is currently realised; all are pending design approvals.

---

## 9. Local run instructions and test results

**Not applicable.** There is nothing to install, run, or test.

- `npm install` → not possible (no `package.json`)
- Test suite → **none** (0 tests exist, therefore 0 passing and 0 failing — this is not a pass)
- Local preview → **none running**; no preview exists yet
- No application was started during Phase 0

---

## 10. UI areas to reuse

**None.** There is no existing markup, component library, design token, image, logo, or typography in the repository.

Consequences:
1. The AutoDine design system must be **created from the brief in Part 5.4** (Ink `#111318`, Warm White `#F6F6F3`, Muted Sage `#6D7F70`, Soft Blue `#DDE7F2`, Sand `#E8E2D8`, Alert `#C75B50`, Inter-compatible typography, restrained motion, `prefers-reduced-motion` honoured).
2. Because nothing exists to reuse, I must **create an initial structure** to host the Phase 1 prototypes. Per Rule 5 I am requesting your approval for that, with options, below.
3. Sample content for prototypes will be realistic Indian-restaurant menu data (₹ pricing), clearly labelled **"Demo data"**.

---

## 11. Recommended next steps

1. **Approve the creation of a minimal, reversible structure** to host the Phase 1 visual prototypes (see decision Q1).
2. **Choose the prototype technology** — my recommendation is a **zero-dependency static HTML + CSS (+ tiny vanilla JS for interaction states)** prototype. Reasons: it is viewable locally and in the live preview, it creates **no production lock-in**, it is trivially deletable, and it lets you compare three directions purely on design before any framework decision is made. (Decision Q2.)
3. **Choose the prototype depth** for the first review round (see decision Q3).
4. On your answers I build the three directions, run them in a live preview so you can click through desktop+mobile views, and then iterate on your chosen direction until you explicitly lock it.
5. Only after UI lock do I present the Phase 6 backend options (A/B/C) with costs and a recommendation.

---

## 12. Files changed in Phase 0

| File | Change |
|---|---|
| `docs/PHASE_0_AUDIT.md` | Added — this report |
| `docs/FLOWCHARTS.md` | Added — the seven locked flowcharts from the specification, recorded as **specification only, not implemented** |
| `README.md` | Untouched (still `# new`) |
| Application code | None created |

---

## 13. Acceptance criteria met / not met

**Met**
- Audited repository structure, package files, history, branches, remotes, and hidden files ✓
- No secrets inspected, extracted, or exposed ✓
- No destructive action taken; no file deleted or overwritten ✓
- Findings reported honestly, including the fact that no project exists ✓
- Flowcharts recorded as product specification ✓

**Not met (and why)**
- "Run the application locally" and "run existing tests" — **impossible**: there is no application and no tests. Reported rather than faked.
- "Existing architecture / route inventory / database summary / lifecycle" — reported as **empty** rather than inferred.

---

## 14. Decisions requiring your approval

1. **Create the initial project structure?** (Rule 5)
2. **Prototype technology** for the Phase 1 visual alternatives.
3. **Prototype depth** for the first review round.
4. *(Deferred, not now)* Backend architecture, payment providers, hosting, plan limits, rotating-QR lifecycle, AI/OCR tooling.

---

## 15. Phase completion report (Part 19 format)

| Field | Value |
|---|---|
| **Phase** | 0 — Repository Audit |
| **Status** | Complete (read-only; blocked from proceeding by design) |
| **What changed** | Two documentation files added; zero application code |
| **Files changed** | `docs/PHASE_0_AUDIT.md`, `docs/FLOWCHARTS.md` |
| **Features implemented** | None (audit phase) |
| **Tests executed** | None possible — 0 tests exist. Not a pass. |
| **Manual checks completed** | File inventory, git history, branches, remotes, config, tooling versions, secret scan (none present) |
| **Security or data risks** | None realised. 9 forward-looking risks recorded in §8. No `.gitignore` exists yet (R8) |
| **Known limitations** | Empty repository — every product requirement is unbuilt; nothing to reuse or migrate |
| **Dependencies or costs introduced** | **None.** No package installed, no service activated, no paid provider touched |
| **Screenshots / visual preview** | None — no application exists to preview |
| **Acceptance criteria met** | §13 |
| **Acceptance criteria not met** | §13 (run/tests — impossible, nothing exists) |
| **Recommended next phase** | Phase 1 — Finalize the visual UI/UX, **pending your approval of §14 items 1–3** |
| **Decisions requiring approval** | §14 |
