# Device preparation and acceptance pack (2026-11-14)

**Status: preparation only.** No device was tested, no hardware was purchased, no
store was visited. This is the acceptance checklist for the pilot devices, to be
executed on the approved staging/pilot environment — never on production data.

## Supported surfaces (source of truth: AGENTS.md + Invoice Spec v1.0)

- **Browser/OS printing only.** No USB/Bluetooth/LAN printer integration; no KOT
  print (screen-first tickets). A4, 58mm and 80mm receipt layouts, PDF download
  and secure share already exist in the app.
- Kitchen display is **screen-first** with Realtime order feed and audio
  announcement (Hindi phrase). Kiosk route: `/dashboard/display`.
- Languages: English + Hindi UI (Marathi content for announcements).
- Reduced-motion and touch targets are part of the existing design system.

## Device matrix to accept

| # | Role | Device class | Minimum spec | Browser | Notes |
|---|---|---|---|---|---|
| D1 | Owner | Android or iPhone | mid-range, 2020+ | Chrome / Safari latest | Dashboard, reports, invoice share, QR management |
| D2 | Manager | Android tablet or phone | same | Chrome | Same as owner minus subscription actions |
| D3 | Cashier | Android tablet (10″) or Windows mini-PC + monitor | 4GB RAM | Chrome latest | Settle/close flow, print dialog, share link |
| D4 | Kitchen | Android tablet (10–15″) or dedicated monitor + mini-PC | 1080p+, speakers | Chrome latest | `/kitchen` + `/dashboard/display` kiosk; auto-refresh off-limits — Realtime only |
| D5 | Customer | Any phone | — | default browser | QR scan → verify code → order → pay at counter |
| D6 | Printing | Any thermal (58/80mm) or A4 laser/inkjet | OS driver | — | Via OS print dialog from the invoice/receipt page |

## Acceptance checklist per device

1. Sign in / sign out / session expiry behaves; re-login restores role and outlet.
2. Role gates: cashier cannot open owner-only screens; kitchen cannot open
   reports; owner sees subscription screens read-only where designed.
3. Kitchen: new order appears ≤ 2s after guest submit on a healthy Realtime
   link; audio announcement plays after first user gesture; screen-sleep does
   not kill the feed (test 30 min idle); `kitchen_realtime_degraded` fallback
   message renders when the channel cannot connect.
4. Kiosk: `/dashboard/display` stays awake (OS-level), no horizontal scroll at
   1366×768 and 1920×1080, verification code visible from 3m.
5. Cashier print: receipt renders on 58mm, 80mm and A4 without clipped totals;
   GST documents (when configured) show GSTIN/breakdown or the Bill of Supply
   statutory notice; browser print preview = downloaded PDF = OS print.
6. Customer journey on a mid-range Android over the venue's Wi-Fi:
   scan → 6-digit code → menu → order with add-ons → pay-at-counter notice →
   order status. No camera/mic permission demands beyond the scan.
7. Network reality: repeat (6) on a congested cell connection; the app must
   fail with retry guidance, not a white screen or a duplicate charge.
8. Restaurant Wi-Fi isolation: guest VLAN cannot reach staff devices; staff
   devices reachable only from staff VLAN. (Venue network, verified by the venue.)
9. Reduced motion + large text: critical kitchen and cashier flows remain
   usable with OS reduced-motion and 125–150% text scaling.
10. Assistive tech: owner report screen and cashier settle flow reachable with
    keyboard alone; screen reader announces invoice-issued state.

## What the owner must supply for the acceptance run

- One device per row of the matrix (or the closest real pilot devices).
- The venue or a test bench with representative Wi-Fi (and a shared-NAT note if
  guests sit behind one address — expected in venues).
- A staging outlet with synthetic orders, or an explicitly authorized pilot
  outlet. **Never a live service with real customer money for a test.**
- Printer model(s) actually bought, with OS drivers installed.

## Approval boundaries

Any failure in items 3, 5 or 6 blocks pilot for that device class. Items 9–10
are strongly recommended and are recorded as advisory for pilot, mandatory for
general availability. Hardware/vendor changes vs this matrix are explicit owner
decisions, not silent substitutions.
