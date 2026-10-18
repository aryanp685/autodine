# AutoDine — UI/UX Baseline (LOCKED)

**Status:** 🔒 LOCKED — 2026-10-19, approved by owner
**Approved direction:** **Option A — Editorial Minimal**
**Instruction on record:** *"option A. editorial minimal is perfect — lock it and I want that exact same with no changes in any thing ui ux frontend."*

This document is the **source of truth** for every AutoDine screen. It is a description of the approved prototype in `app/design/a/*`, styled by `styles/direction-a.css`. Where this document and a designer's opinion disagree, this document wins. Any change to it requires explicit owner approval.

> **Absolute rule for implementation (Phase 7+):** build the production frontend to match the locked Option A prototype **exactly**. No redesigning screens, no "improving" spacing, no substituting components. If something must change for a technical reason, stop and ask.

---

## 1. Design character

Large typography, generous whitespace, restrained colour, elegant restaurant imagery. Hairline rules instead of boxes; no shadows; separation comes from space and rules, not elevation. Reads like a premium restaurant brand rather than a software tool.

**What it optimises for:** brand impression, customer-menu legibility at any age, timelessness.
**Known trade-off (accepted at lock):** lower information density — the kitchen board must be handled carefully at high order volume. Do not "fix" this by densifying without approval.

---

## 2. Colour

### Base palette (from the Part 5.4 brief — unchanged)

| Token | Hex | Role |
|---|---|---|
| Ink | `#111318` | Text, primary buttons, dark surfaces |
| Warm White | `#F6F6F3` | Page background |
| Muted Sage | `#6D7F70` | Accent, success, vegetarian/session-verified marker |
| Soft Blue | `#DDE7F2` | Informational surfaces, secondary states |
| Sand | `#E8E2D8` | Bands, image frames, chips, trial strip |
| Alert | `#C75B50` | Errors, unpaid, sold out, destructive |

### Derived tokens — as implemented in `[data-dir='a']`

| Token | Value | Notes |
|---|---|---|
| `--page-bg` | `#f6f6f3` | Warm White |
| `--surface` | `#ffffff` | Cards, panels, sheets |
| `--border` | `rgba(17, 19, 24, 0.16)` | Hairline rules — restrained, never heavy |
| `--text` | `#111318` | |
| `--accent` | `#6d7f70` | Muted Sage |
| `--shadow` | `none` | **Shadows are not part of this design system** |
| `--radius-sm` | `2px` | Buttons, inputs, small chips |
| `--radius` | `3px` | Cards, panels |
| `--radius-lg` | `4px` | Large containers |

### Semantic colours used in-product

| Meaning | Value | Used for |
|---|---|---|
| Success / paid / verified | text `#47584a` on sage tint `rgba(109,127,112,0.14)` | "Paid online", verified-session dot, positive deltas |
| Alert / unpaid / sold out | text `#9c3f36` / `#b05346` on tint `rgba(199,91,80,0.10)` | "Counter due", unpaid banner, sold-out label, negative deltas |
| Trial warning | `#b8860b` on `#efe9dd` fill, border `#ddd5c4` | Trial strip, trial progress bar, day-count badge |
| Informational | `#2f4661` on `#dde7f2` | Notes, secondary states |
| Sand text/chip | `#5a5142` on `#e8e2d8` | Bestseller badge, plan status chip |
| Order age — fresh | `#4b6b51` | < 10 min |
| Order age — warn | `#b8860b` | 10–19 min |
| Order age — late | `#b05346` | ≥ 20 min |

---

## 3. Typography

**Family:** `Inter` first, then `Inter var`, then `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif`.
*(Loaded via system stack in this environment — no webfont fetch. Confirmed safe for production with `next/font/local` if a bundled Inter is wanted later; that change requires approval.)*

| Element | Size | Line height | Weight | Tracking |
|---|---|---|---|---|
| Public hero H1 | 76 px | 1.02 | 500 | −0.04em |
| Public section H2 | 44 px | — | 500 | −0.03em |
| Public stat value | 44 px | — | 500 | −0.03em |
| Public feature title | 25 px | — | 500 | −0.02em |
| Cart H1 | 44 px | — | 500 | −0.035em |
| Checkout H1 | 40 px | — | 500 | −0.03em |
| Dashboard H1 | 34 px | — | 500 | −0.03em |
| Dashboard stat value | 42 px | — | 500 | −0.035em |
| Shared page title (`.pg__title`) | 40 px | — | 500 | −0.03em |
| Customer venue name | 30 px | — | 500 | −0.03em |
| Item sheet title | 28 px | — | 500 | −0.02em |
| Kitchen venue H1 | 26 px | — | 500 | −0.02em |
| Dish name | 20 px | — | 500 | −0.02em |
| Card/section H2 | 19–20 px | — | 500 | — |
| **Body** | 15 px | 1.55 | 400 | — |
| Body (secondary) | 14.5 px | 1.6 | 400 | — |
| Small / meta | 13–13.5 px | 1.6 | 400 | — |
| Kicker / eyebrow | 11.5 px | — | 700 | 0.14em, uppercase |
| Table header | 11.5 px | — | 600 | 0.1em, uppercase |

**Rules:**
- **All money, times, quantities and counts use tabular numerals** (`font-variant-numeric: tabular-nums`). Non-negotiable — it is what makes the operational screens readable.
- Large headings use weight 500, not 600/700. Weight 600/700 is reserved for kickers, table headers, and emphasis inside dense data.
- Body line-height 1.55–1.75 depending on context; long-form copy uses 1.7.

---

## 4. Spacing & layout

**Scale (px):** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 — exposed as `--s-1` … `--s-9`.

| Context | Gutter / padding |
|---|---|
| Desktop page gutter | 48 px |
| Mobile page gutter | 20–24 px |
| Section vertical rhythm | 88 px desktop / 56 px mobile |
| Card padding | 20–34 px |
| Dashboard rail padding | 30 / 26 px |

**Grids (locked):**

| Screen | Grid |
|---|---|
| Owner dashboard | `264px` rail + fluid content |
| Cart | `1fr` + `380px` sticky summary, 72 px gap |
| Checkout | `1fr` + `380px` sticky summary, 72 px gap |
| Kitchen board | 3 equal columns, 44 px gap |
| Cashier | `400px` queue + fluid detail, 72 px gap |
| Menu editor | `240px` categories + fluid list + `340px` editor, 44 px gap |
| Customer menu | single column, dish rows with 104 px thumbnail |
| Tables & QR | 3 cards; print sheet 3 × 2 on A4 |

**Component sizing:** dish thumbnail 104 px (76 px mobile) · sheet panel `min(580px, 100%)` · stat blocks auto.

---

## 5. Navigation model

| Surface | Model |
|---|---|
| **Public site** | Minimal top bar, hairline bottom rule. Brand left, links centre-left, "Sign in" + solid "Start 10-day trial" right. No mega-menu, no sticky shrink. |
| **Owner dashboard** | Slim left rail. Brand → venue block → nav list → trial footer. **Active item = 2 px Ink left border + `padding-left: 12px; margin-left: -14px`** (signature detail — keep it). |
| **Customer menu** | Horizontal category nav, hairline bottom rule, active = 600 weight + `inset 0 -2px 0` Ink underline. Cart summary is a sticky bottom bar. |
| **Item customization** | Centred modal sheet over a dimmed, blurred menu. |
| **Kitchen** | Single header row: venue left, audio control / test / replay / live-status right. No sidebar. |
| **Cashier** | Two-pane: queue list left, order detail + payment right. |
| **Shared pages** (pricing, signup, menu editor, tables, states) | Hairline top bar with brand + section links; menu editor adds a sub-bar with menu tabs and the Draft → Review → Approve → Publish flow. |

---

## 6. Components

**Buttons** — radius 2 px, padding 9–15 px × 14–28 px, 13–15 px text. Variants: solid Ink (primary), 1 px Ink outline (secondary), quiet (no border, tinted hover), ghost. Disabled = 45 % opacity, never removed from the layout.

**Cards / panels** — 1 px hairline border, radius 3 px, **no shadow**, white on Warm White.

**Badges / pills** — radius 999 px, 11.5 px / 600, tinted fills. Tones: sage, alert, blue, sand, ink, outline.

**Inputs & selects** — radius 2 px, 1 px hairline border, 10 px × 12 px padding, 14 px text. Labels 13 px / 600 in 70 % Ink. Hints 12 px in 55 % Ink.

**Tables** — no vertical rules. Header 11.5 px uppercase 0.1em in 55 % Ink with a single hairline under it; rows separated by `rgba(17,19,24,0.08)`; hover `rgba(17,19,24,0.08)`.

**Toggles** — 26 × 14 px pill, sage when on, grey when off.

**Progress** — 6 px track, `rgba(17,19,24,0.12)`, accent fill (amber for trial).

**Veg / non-veg marker** — 14 px square, green `#2f7a3f` for veg; rotated 45° square, red `#a33a2f` for non-veg. Indian convention — keep it.

**QR chip** — deterministic generated pattern, white background, 4 px padding, radius 6 px.

**Skeleton** — shimmer gradient, radius 6 px, matches final layout to avoid content jump.

---

## 7. Imagery & iconography

- Full-bleed restaurant photography in the public hero, dark gradient scrim, white text over it.
- Dish thumbnails: square, `object-fit: cover`, radius 3 px, Sand placeholder when no image.
- No icon set beyond emoji used sparingly for audio/notification affordances. Do not introduce an icon library without approval.

---

## 8. Motion

- Transitions limited to 120 ms on background / border-color / transform. Buttons translate 1 px on press.
- **No entrance animations, no page transitions.**
- `@media (prefers-reduced-motion: reduce)` globally neutralises animation and transition durations.

---

## 9. Responsive rules

Breakpoint is a **CSS container query at 1000 px** (`@container frame (max-width: 1000px)`), driven by the prototype frame width; the production build should use an equivalent media/container query.

At ≤ 1000 px:
- All multi-column grids collapse to one column (hero three-up, plans, dashboard stats → 2-up, kitchen → 1 column, cart/checkout/cashier stacks).
- Gutters drop to 20–24 px; public nav wraps; dashboard rail becomes a horizontal scrolling bar (venue, nav list and trial footer hidden).
- Customer dish thumbnails shrink to 76 px; category nav scrolls horizontally.
- Sticky summaries become static.

---

## 10. States (locked behaviour)

| State | Treatment |
|---|---|
| Loading | Skeleton matching final layout |
| Empty | Icon + short explanation + one next action (never just "no data") |
| Error | Alert-tinted block, states plainly that data is safe, "Retry now" |
| Success | Sage-tinted block naming what changed, then follow-up actions |
| Disabled | 45 % opacity, stays in layout, helper text explains why |
| Sold out | Row at 55 % opacity + "Sold out for now" in alert colour |
| Unpaid order | Alert-tinted bar on the kitchen card, "Unpaid · pay at counter" |
| Trial active | Sand strip, amber dot, days remaining, "View plans" |
| Trial expired | Locked panel: data preserved, explicit still-available / blocked lists, "Reactivate" |
| Session verified | Sage dot + "Table 7 · on-site verified 12:41 PM" |

---

## 11. Screen inventory covered by the lock

Public: Home · Pricing · Sign up
Owner dashboard: Overview · Menu editor · Tables & QR
Customer: Menu · Item customization · Cart · Checkout
Kitchen: Order board
Cashier: Counter payments
Cross-cutting: States & trial UI

Representative layouts for these 13 screens are the locked reference. Screens in the full inventory that are **not** yet designed (FAQ, contact, login, policies, AI import review, brand studio, order history, kitchen/voice settings, payments & receipts, sales reports, staff & permissions, subscription & billing, account/security, order tracking, receipt view, invalid/expired QR) **must be derived from these tokens and patterns**, then shown for approval before implementation.

---

## 12. Rejected alternatives (recorded for the audit trail)

| Direction | Why rejected |
|---|---|
| **Option B — Modern Operations** | Rejected 2026-10-19 in favour of Option A. Its strengths (density, state-forward kitchen board) were acknowledged, but the owner wants the editorial brand character. Retained in `app/design/b/*` + `styles/direction-b.css` as a reference; **not** to be used for production screens. |
| **Option C — Warm Hospitality** | Rejected 2026-10-19 in favour of Option A. Rounded/shadowed surfaces conflict with the hairline, no-shadow character of the chosen direction. Retained in `app/design/c/*` + `styles/direction-c.css` as a reference; **not** to be used for production screens. |

Both rejected directions remain in the repository untouched. Removing them is a destructive change and will only be done on your explicit instruction.
