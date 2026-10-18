# AutoDine — Phase 1: Visual UI/UX alternatives

**Phase:** 1 — Finalize the visual UI/UX
**Status:** Complete — **awaiting your direction choice and design lock**
**Date:** 2026-10-18 · branch `arena/62c92cc6-new`
**Live prototype:** dev server on port 3000 → `/design`

---

## 1. What was built

Thirteen screens × three directions = **39 clickable prototype screens**, plus a comparison hub at `/design`.

| | |
|---|---|
| Structure | Next.js 15 (App Router) + TypeScript, plain CSS with design tokens. No UI library, no Tailwind, no component dependencies. |
| Prototype area | `app/design/` — self-contained and deletable without touching anything else |
| Demo data | `lib/demo-data.ts` — "Saffron & Smoke", Nagpur; INR pricing; clearly labelled demo content |
| Imagery | 4 generated photographs in `public/img/` (~1.2 MB total) |
| Responsive | Desktop / tablet / mobile toggle in the top bar, driven by CSS **container queries** so the layout responds to the frame width, not your browser window |
| Interactivity | Category filtering, add-to-cart, quantity steppers, variant/modifier selection, payment-method choice, audio on/off, cashier method switch, checkout state preview. No persistence — state resets on reload. |

### Screen inventory in this round

Public: **Home**, **Pricing**, **Sign up** ·
Owner dashboard: **Overview**, **Menu editor**, **Tables & QR** ·
Customer: **Menu**, **Item customization**, **Cart**, **Checkout** ·
Kitchen: **Order board** · Cashier: **Counter payments** ·
Cross-cutting: **States & trial UI**.

**Bespoke per direction** (different layout, not just different colours): home, dashboard, customer menu, item sheet, cart, checkout, kitchen, cashier.
**Shared structure, re-skinned**: pricing, signup, menu editor, tables & QR, states — because the open question on those screens is styling, not layout.

---

## 2. The three directions

### Option A — Editorial Minimal
Large display typography (hero 76 px), generous whitespace, hairline rules instead of boxes, full-bleed restaurant photography, no shadows. The public site reads like a premium restaurant brand; the dashboard breathes.
- **Best at:** brand impression, customer menu legibility, timelessness.
- **Weakest at:** kitchen density under high order volume; large type can push operational numbers down the page; depends on good photography.

### Option B — Modern Operations
Compact dark top bars, icon sidebar, dense tables, tabular numerals, Soft Blue as the cool operational surface. Payment and preparation state are the loudest thing on every screen. Four-column kitchen board, unpaid orders flagged in red, keyboard shortcuts shown.
- **Best at:** kitchen and cashier under pressure; highest information density; scaling to many tables.
- **Weakest at:** less emotive on the marketing site; needs discipline to avoid feeling like a spreadsheet.

### Option C — Warm Hospitality
Rounded cards (18–24 px), soft layered shadows, Sand-forward surfaces, sage CTAs, friendly voice. Customer flow uses large tap targets, a sticky rounded cart bar and a bottom-sheet item customizer.
- **Best at:** most approachable customer ordering, especially on phones; restaurant themes sit naturally on top.
- **Weakest at:** softness can weaken urgency signals in the kitchen; rounded cards cost usable space on dense screens; needs contrast checking on Sand.

All three stay inside the briefed palette (Ink `#111318`, Warm White `#F6F6F3`, Muted Sage `#6D7F70`, Soft Blue `#DDE7F2`, Sand `#E8E2D8`, Alert `#C75B50`) and re-weight rather than replace it. Inter-first font stack, `prefers-reduced-motion` honoured.

---

## 3. How to review

1. Open the same screen in all three directions using the **A / B / C** switcher in the black bar — it keeps you on the same screen.
2. Judge the pressure screens hardest: **kitchen board**, **cashier**, **checkout**.
3. Open **States & trial UI** for loading / empty / error / success / disabled, the trial countdown, and the expired read-only mode (including the proposed "still available vs blocked" split).
4. Switch to **Mobile** — most customers will scan and order on a phone.
5. You can mix: e.g. C's customer flow with B's kitchen board. Say so and I'll combine before locking.

---

## 4. Honest limits of this prototype

| Area | Reality |
|---|---|
| Backend | None. No database, auth, API, realtime layer, or tenant isolation. |
| Payments | None connected. Cart and bill totals are computed **in the browser** for demonstration only — in production every total is recomputed and enforced server-side. |
| QR codes | Decorative generated patterns, not scannable codes. |
| Voice | Not implemented. The kitchen screen shows the audio controls, status and replay affordances only. |
| AI menu import | Not built. The menu editor shows the entry point and the Draft → Review → Approve → Publish flow. |
| Tax on bills | Sample 5% figure for layout only, labelled on screen. Final tax treatment is unconfirmed. |
| Plan limits table | **Draft proposal awaiting your approval.** Nothing is enforced. |
| Verification | I confirmed all 39 screens return HTTP 200, TypeScript compiles clean, and the production build prerenders all 44 pages. **I cannot see the rendered pixels** — your visual review is the real check, and I have not verified contrast ratios, hydration warnings, or cross-browser behaviour. |

---

## 5. Decisions recorded / pending

**Decided with your approval:** create structure in-repo · Next.js scaffold · 13-screen subset × 3 directions · the three briefed directions.

**Pending your decision:**
1. Which direction (or combination) to adopt.
2. Any revisions before lock.

**Deferred to later phases (not yet decided):** backend architecture (Phase 6), payment providers, hosting, final numeric plan limits, rotating-QR code lifetime and recovery flow, AI/OCR tooling.

---

## 6. Design lock record — 🔒 LOCKED 2026-10-19

| Field | Value |
|---|---|
| **Locked direction** | **Option A — Editorial Minimal** |
| Owner's instruction | *"option A. editorial minimal is perfect — lock it and I want that exact same with no changes in any thing ui ux frontend."* |
| Approved colour roles | Ink / Warm White / Muted Sage / Soft Blue / Sand / Alert, plus the derived semantic tones — full table in `docs/DESIGN_SYSTEM.md` §2 |
| Typography scale | Inter-first stack; hero 76 px → body 15 px; tabular numerals for all money, times and counts — §3 |
| Spacing & radius system | 4/8/12/16/24/32/48/64/96 px; radius 2 / 3 / 4 px; **no shadows** — §4, §6 |
| Navigation model | Public: minimal top bar · Dashboard: slim left rail with 2 px active marker · Customer: category bar + sticky cart · Kitchen: single control row · Cashier: two-pane — §5 |
| Component conventions | Hairline cards, 2 px buttons, pill badges, uppercase micro-labels — §6 |
| Responsive rules | Container query at 1000 px; single column, 20–24 px gutters, horizontal nav — §9 |
| Deviations approved | **None.** Build it exactly as prototyped. |
| Locked on | 2026-10-19 |
| Full baseline | **`docs/DESIGN_SYSTEM.md`** |

**Status of the design after lock:** zero files changed. `styles/direction-a.css`, `app/globals.css` and every `components/screens/*.tsx` are byte-for-byte what you approved. Options B and C remain in the repository as recorded rejected alternatives, untouched.

The next checkpoint is **Phase 6 — backend and architecture options** (`docs/PHASE_6_BACKEND_OPTIONS.md`), presented for approval before any backend work begins.
