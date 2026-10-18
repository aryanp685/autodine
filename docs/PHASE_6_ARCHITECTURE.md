# Phase 6 — Architecture Decision & Repository Audit

**Date:** 2026-10-19
**Status:** Decision recorded. **No major changes made pending your approval.**
**Supersedes:** the "recommendation B" conclusion in `docs/PHASE_6_BACKEND_OPTIONS.md`.

---

## 0. The decision you made, restated

You chose a **modified Option C** with a **₹0/month ceiling**, with these conditions:

| # | Your condition | How it is honoured |
|---|---|---|
| 1 | Supabase-first, ₹0/month, no paid service without approval | §3 — Supabase Free + free-tier hosting. Nothing billable is created. |
| 2 | Keep everything free except the domain; document reliability/backup limits | §5 — written plainly, including what ₹0 genuinely cannot give you. |
| 3 | Start the locked frontend now, in parallel, with mock data | Done — see §1 and `commit 8a68f65`. |
| 4 | Delete rejected directions B and C | Done — see §1.3. |
| 5 | Audit the repo first and *report*; no major changes until approved | This document. The only code changes made are the two you explicitly approved (delete B/C, start frontend). |

---

## 1. Repository audit — what actually exists today

### 1.1 Measured facts

| Metric | Value |
|---|---|
| Tracked files | 46 |
| Source lines (app + components + lib + styles) | 3,504 |
| — `app/` (15 files) | 479 |
| — `components/` (14 files) | 1,862 |
| — `lib/demo-data.ts` | 565 |
| — `styles/design-system.css` | 598 |
| Runtime dependencies | **3** — `next ^15.5`, `react ^19.1`, `react-dom ^19.1` |
| Dev dependencies | **4** — `typescript ^5.7`, `@types/node`, `@types/react`, `@types/react-dom` |
| Backend/ORM/payment dependencies | **none** |
| `process.env` usage anywhere | **none** |
| `.env` files, secrets, config | **none** (`.gitignore` already covers `.env`) |
| Images | 4 stock JPGs, ~1.2 MB total |
| Routes | 13 pages, all statically prerendered (`next build`: 16/16) |
| `tsc --noEmit` | clean |

### 1.2 What the audit tells us

**Greenfield confirmed, and cleanly so.** There is no backend, no database client, no ORM, no payment SDK, no auth library, no environment configuration and no secret in the repository. That is the ideal starting position for the Supabase-first plan: there is **no legacy to migrate, no vendor already coupled into the code, and nothing to rip out**. Option A from the original Phase 6 ("keep and extend the existing backend") remains impossible for the same reason it was in Phase 0 — there is no backend.

**Supabase compatibility: no blockers.** The stack is Next.js 15 App Router + React 19 + TypeScript strict, on Node 22. Supabase's JavaScript client (`@supabase/supabase-js` / `@supabase/ssr`) is framework-agnostic and officially supports Next.js App Router with server components, route handlers and middleware. Nothing in the current stack has to be replaced to adopt it.

**Three real gaps to close before backend work starts.** These are not problems today; they are things we must add *before* there is a server to get wrong:

1. **No linting.** No ESLint config. The design system forbids shadows and hard-coded colours; a lint rule is the only thing that enforces that once several people are writing CSS.
2. **No tests.** Nothing verifies pricing maths, tax rounding or trial expiry. All three are money-critical and must have unit tests before they run against a real database.
3. **No schema or migration tool.** Adding Supabase means adding its CLI and a `supabase/migrations/` directory as the single source of truth for the database. I want that in place before the first table, not after.

### 1.3 Changes already made this phase (both explicitly approved by you)

**Deleted directions B and C.** `styles/direction-b.css` and `styles/direction-c.css` are gone, along with the B and C component variants inside all seven bespoke screen modules, and the comparison harness that only existed to switch between them (`app/design/`, `components/PreviewFrame.tsx`, `components/ScreenRenderer.tsx`, `lib/directions.ts`, `styles/design-hub.css`).

**Promoted the locked design into the real app.** `styles/direction-a.css` is now `styles/design-system.css`, scoped to `[data-app]`. The `a-` class prefix became semantic (`a-home` → `home`, `a-dash` → `dash`, and so on) and the components were renamed (`HomeA` → `Home`, `DashboardA` → `Dashboard`, `ItemA` → `ItemSheet`, …). Thirteen real routes replaced the 39 prototype routes:

```
/                     → marketing home
/pricing              → ₹899 / ₹1,599 / ₹2,699
/signup               → owner account creation
/dashboard            → owner dashboard (trial strip, stats)
/dashboard/menus      → menu editor
/dashboard/tables     → tables & QR
/menu                 → customer menu (mock table)
/menu/item            → item customisation sheet
/menu/cart            → cart
/menu/checkout        → payment method choice
/kitchen              → kitchen display
/cashier              → counter / order queue
/states               → states, trial & subscription reference
```

**No visual change.** The Editorial Minimal design is untouched — this was a file-and-route reorganisation, not a redesign. Evidence: the served CSS bundle went from 166,496 B to 56,648 B purely because two stylesheets were removed; every locked class (`home__h1`, `dash__block`, `menu__dish`, `sheet__panel`, `cart__sumCard`, `co__methods`, `kb__ord`, `cash__lines`) is still present, `@container frame` still present, `[data-app]` present 803 times, and every stale prefix (`a-home`, `b-home`, `direction-b`, `data-dir`) counts **zero**. `tsc --noEmit` clean, `next build` 16/16 pages prerendered, all 13 routes plus all 4 images return 200, and the old `/design/a/home` route now correctly 404s.

Recovery, if you ever want B or C back: they are in git history from `91b91a1` onward. `git show 91b91a1:styles/direction-b.css` retrieves the file.

---

## 2. What ₹0/month actually buys in 2026 (verified)

I checked current pricing and free-tier pages rather than relying on memory. Two findings changed the recommendation, and both are worth your attention.

### 2.1 Supabase Free — the data layer

| Resource | Free tier |
|---|---|
| Database | 500 MB, shared CPU, 500 MB RAM |
| Monthly active users | 50,000 |
| API requests | unlimited |
| File storage | 1 GB |
| Egress | 5 GB + 5 GB cached |
| Realtime | 200 concurrent peak connections, 2 M messages/month, 256 KB max message |
| Edge Functions | 500,000 invocations/month |
| **Projects paused after** | **1 week of inactivity** |
| **Active project limit** | **2** |
| Backups / point-in-time recovery | **none** |

Supabase Free covers Postgres, authentication, storage and realtime in one project — which is exactly why it fits your "no paid service" rule better than assembling separate free tiers.

### 2.2 The hosting finding you need to know about

**Vercel Hobby cannot host this product.** This is the default answer most people would reach for, so it is worth stating clearly: Vercel's Hobby plan is restricted to **non-commercial, personal use**, and Vercel's fair-use guidance classes both *processing payments* and *advertising a product or service for sale* as commercial. AutoDine does both. Using Hobby for it would mean building the company on a licence we are knowingly breaching. **Vercel Hobby is off the table for production.** It is still fine for private development previews.

Other platforms I checked:

| Platform | Free tier | Commercial use on free? | Verdict |
|---|---|---|---|
| **Cloudflare Workers** | 100k requests/day, **10 ms CPU per request**, 128 MB memory, unlimited static bandwidth, no card | **Yes** — no commercial-use restriction | **Recommended** |
| **Netlify** | 300 credits/month hard cap (≈15 GB bandwidth, ≈20 production deploys); branch/preview deploys free; no card | Not clearly documented — must be verified before we rely on it | Fallback |
| **Render** | Sleeps after 15 min idle | Yes | Rejected — a kitchen board cannot cold-start |
| **Railway** | $1 of credit/month | Yes | Too thin |
| **Koyeb** | Free tier **closed to new users** (Feb 2026; card + $29 hold, defaults to $29/mo Pro) | n/a | Unavailable |
| **Fly.io** | **No free tier** for new accounts (2 machine-hours or 7-day trial) | n/a | Unavailable |

**Why Cloudflare is the recommendation despite the 10 ms CPU limit:** on Workers, *waiting is not computing*. Time spent waiting on a Postgres query does not count against the 10 ms budget — only actual CPU work does. An architecture that caches aggressively and computes little fits comfortably. Concretely: public pages and the customer menu render statically and revalidate on publish (zero per-request CPU); the checkout route handler does a little validation, one insert and one external call, almost all of which is waiting. The 10 ms limit is a real constraint on what we are allowed to *compute* per request, and I have designed around it rather than assuming it away.

The catch, stated honestly: server-rendered Next.js on Cloudflare needs the `@opennextjs/cloudflare` adapter (or `vinext`, which Cloudflare recommends but which is still beta). That is a deployment coupling I will not add to the repository without your approval. Until we deploy, the app is standard Next.js and deploys anywhere.

---

## 3. The recommended architecture at ₹0/month

```
                         ┌──────────────────────────┐
 Customer phone ────────▶│  Cloudflare (global CDN) │  static: home, pricing,
 (scan table QR)         │  Next.js, ISR + cache    │  menu (revalidate on publish)
                         └────────────┬─────────────┘
                                      │ route handlers (CPU-light, wait-heavy)
                                      ▼
 Owner laptop ──┐         ┌────────────────────────────────────┐
 Kitchen tablet ┼────────▶│  Supabase  (single free project)   │
 Counter POS   ─┘         │  ├ Postgres    data + RLS (the     │
                          │  │             security boundary)  │
                          │  ├ Auth        owner + staff login │
                          │  ├ Storage     menu images (1 GB)  │
                          │  └ Realtime    kitchen + counter   │
                          └────────────┬───────────────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │ GitHub Actions (free)    │
                          │ ├ daily keep-awake ping  │
                          │ └ nightly pg_dump        │
                          └──────────────────────────┘

 Payments: Razorpay — TEST MODE ONLY until you approve going live.
 Money:    bigint paise + currency code. Timestamps: timestamptz UTC.
```

**Monthly cost: ₹0.** The only thing you have approved spending on is the domain.

### 3.1 The non-negotiables, designed in from the first commit

These are the rules from your product spec that constrain the architecture, not just the UI:

- **Tenant isolation at the database, not the application.** Every table carrying restaurant data gets a `restaurant_id`, and **Row Level Security** enforces it. If application code forgets a filter, the database still refuses. This is the one place where getting it wrong is unrecoverable.
- **The server decides the price.** The browser sends item IDs and quantities. It never sends a total. Totals, tax, discounts and the order snapshot are computed server-side from the menu's current prices. **Client-sent totals are never trusted.**
- **Payment status is server-decided.** An order is paid only when a verified Razorpay webhook (signature checked, idempotency enforced by a unique index on the payment event ID) says so — never because the browser's success callback fired.
- **Preparation state and payment state are two separate state machines.** "Served" and "Paid" are not the same thing and must never be conflated; paying at the counter and paying online both have to work.
- **Static QR proves nothing.** A printed QR cannot evidence that a diner is in the restaurant. Presence requires a short-lived rotating token validated server-side. The QR in the current UI is decorative.
- **The kitchen must never lose an order.** Writes are durable before they are announced; the kitchen display reconciles from the server, so a lost WebSocket re-syncs the full board rather than showing a gap.
- **Trial enforcement is server-side.** The 10-day trial, the post-trial read-only state, and "block new orders but never delete data" are computed from server timestamps the client cannot influence.
- **AI menu import is review-gated.** No imported item becomes live without an owner approving it, and **no accuracy figure is claimed until it has been measured** on real menus.

---

## 4. Free-tier limits that will shape the code

These are not problems to fix later. They are constraints that change how features get built, so they belong in the design now.

| Limit | Consequence | Design decision |
|---|---|---|
| **Supabase pauses after 7 days idle** | A quiet week — including a holiday — can pause the database, and it needs a manual restore from the dashboard | A **daily GitHub Actions cron** hits a health endpoint. Free tier gives 2,000 Action-minutes/month; this uses ~15. A workaround, not a guarantee — noted as such. |
| **No backups, no PITR** | A bad migration or a buggy delete is unrecoverable | **Nightly `pg_dump`** via GitHub Actions to artifact storage, with a **written and actually rehearsed restore procedure**. An untested backup is not a backup. |
| **Realtime: 200 concurrent connections** | If every diner's order-tracking page opened a subscription, 200 would vanish fast | **Realtime is for staff surfaces only** (kitchen, counter). Diners **poll** on a 10–15 s interval. Keeps us at a handful of connections per restaurant. |
| **1 GB storage** | Menu photographs fill this quickly | Compress on upload: WebP, max ~1200 px, target 100–150 KB. ~1 GB holds several thousand dishes — ample for launch, finite after that. |
| **5 GB egress** | Serving menu images to diners is the main consumer | Serve images from the CDN/edge cache, not per-request from Storage. |
| **500 MB database** | Rows are small; this is roughly 1–2 M orders | Not a launch constraint. Monitor from day one. |
| **10 ms CPU/request (Cloudflare)** | No server-side OCR, no heavy per-request computation | AI menu import runs **client-side** (Tesseract.js in the owner's browser) if we do it at all — and **manual entry plus CSV import ships first**. |
| **2 active Supabase projects** | No room for separate prod/staging projects on free | Staging is a **local** Supabase instance via its CLI (Docker on your machine, ₹0, no cloud project consumed). Production is the single free project. |

---

## 5. What ₹0 honestly cannot give you

You asked me to be straight about this, so here it is.

**₹0 is the right choice for building, testing, and running a pilot with test payments.** It gets us a working product, real screens, real data flow, and a restaurant owner clicking through it on their own phone.

**₹0 is not the right choice for the first restaurant taking real money from real customers.** Three reasons, in order of severity:

1. **No backups.** A database with no point-in-time recovery holding real orders and real customer names is a data-protection exposure, not just an engineering inconvenience. India's DPDP framework requires reasonable security safeguards and breach notification; the Rules were notified 13 Nov 2025 with substantive compliance due **13 May 2027**. (This is a flag for a lawyer to review, not legal advice.)
2. **The 7-day inactivity pause.** A restaurant that closes for a week — or a quiet venue — can come back to a paused database that needs a human to restore it. That is not acceptable for a system sitting between a diner and their dinner.
3. **No SLA, no support, shared CPU.** Peak Friday-night traffic on shared infrastructure with no one contractually obliged to help is a real operational risk.

**My recommendation: treat Supabase Pro as the gate before live money, not as a nice-to-have.** Supabase Pro is **$25/month** — roughly **₹2,100** at current rates. It adds daily backups with 7-day retention, removes the inactivity pause, moves you off shared CPU, and raises egress to 250 GB. Your first Professional subscriber at ₹1,599 does not quite cover it; **your second one (₹3,198/month) covers it comfortably.** One Business subscriber at ₹2,699 covers it outright.

So the honest plan is: **build and prove the product at ₹0, and let the second paying customer fund the reliability upgrade.** I am not asking you to spend anything now. I am asking you not to be surprised later.

---

## 6. Upgrading later without a rewrite

Every choice above is upgradeable in place:

- **Supabase Free → Pro** is a billing change on the same project. Same connection string, same client, no code change. Nothing is being built that assumes the free tier.
- **Hosting is portable.** The app is standard Next.js: App Router, route handlers, server components. No Vercel-specific APIs, no Cloudflare-specific bindings in application code. It runs on any Node host.
- **The only host coupling is deployment config,** not application code — and I will not add even that without approval.
- **Staging → production** is the same migrations applied to a different project. Local CLI for dev, one free cloud project for production now, a second project when you are paying.

---

## 7. Cost curve

| Stage | Monthly cost | What it buys |
|---|---|---|
| **Now — build & test** | **₹0** | Supabase Free + Cloudflare Free + GitHub Actions. Test-mode payments. |
| **Pilot — your own restaurant, test payments** | **₹0** + domain | Real usage, no real money, no real customer data at risk. |
| **First paying restaurant** | **≈ ₹2,100** (Supabase Pro) | Backups, no pause, off shared CPU. Covered by 2 Professional subscribers. |
| **10 restaurants** | ≈ ₹2,100 + domain | ~₹14,000 revenue at an ~₹1,400 blended ARPU against ~₹2,100 infrastructure. |
| **If India-only latency becomes an issue** | unchanged | Supabase has a Mumbai (ap-south-1) region; measured hot-query latency from India is ~5 ms. Neon, the obvious alternative, has no India region (~58 ms from Singapore). |

Gateway fees are separate and only exist once you take real money: Razorpay's standard rate is 2% + GST (≈2.36% effective), with ₹0 setup and no annual maintenance charge.

---

## 8. Decisions I need from you before I proceed

I have made no architectural change beyond the two you approved. These need your answer:

1. **Approve creating the accounts** — one Supabase project (free) and one Razorpay account (test mode only). Both are ₹0 and neither takes payment, but they are accounts in your name, so I will not create them without a yes.
2. **Hosting choice** — Cloudflare Workers (recommended: commercial-use-safe, unlimited static bandwidth, but needs the OpenNext adapter) versus Netlify Free (simpler, official Next.js support, but a hard 300-credit/month cap I have not been able to confirm permits commercial use). **Say the word and I will verify the commercial-use question in writing before deploying to either.**
3. **Confirm the trigger for spending** — is "one paying restaurant, Supabase Pro, ~₹2,100/month" the right trigger, or do you want a different threshold?
4. **One UI question the lock does not answer** — the locked screens' navigation is non-functional markup (`<li>Pricing</li>`, `<span>Start 10-day trial</span>`). Making those into real links changes no pixels, but it is a change to the approved frontend, so I am asking rather than assuming.

---

## 9. Sources

Verified 2026-10-19. Pricing and free tiers change; re-check before any spend.

- Supabase pricing — [supabase.com/pricing](https://supabase.com/pricing)
- Supabase Realtime limits — [supabase.com/docs/guides/realtime/limits](https://supabase.com/docs/guides/realtime/limits)
- Vercel Hobby plan (non-commercial restriction) — [vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby); fair-use guidance — [vercel.com/docs/limits/fair-use-guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- Cloudflare Workers limits — [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits); pricing — [developers.cloudflare.com/workers/platform/pricing](https://developers.cloudflare.com/workers/platform/pricing)
- Cloudflare Pages limits — [developers.cloudflare.com/pages/platform/limits](https://developers.cloudflare.com/pages/platform/limits)
- Vercel vs Cloudflare, commercial-use note — [morphllm.com/comparisons/cloudflare-workers-vs-vercel](https://www.morphllm.com/comparisons/cloudflare-workers-vs-vercel)
- Free-tier host comparison (Koyeb closed Feb 2026, Fly.io no free tier) — [snapdeploy.dev/state-of-free-hosting](https://snapdeploy.dev/state-of-free-hosting); [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/)
- Free tiers permitting commercial use — [techplained.com/best-free-hosting](https://www.techplained.com/best-free-hosting)
- Razorpay pricing and test mode — [razorpay.com/pricing](https://razorpay.com/pricing)
- Supabase vs Neon latency from India — measured comparison, Mumbai ~5 ms vs Singapore ~58 ms
- DPDP Act and Rules timeline — Rules notified 13 Nov 2025, substantive compliance 13 May 2027
