# AutoDine — Required Flowcharts (Part 17)

> **Status: SPECIFICATION ONLY — NOT IMPLEMENTED.**
> These diagrams are the locked product behaviour recorded from the specification. As of 2026-10-18 there is no code implementing any of them (see `docs/PHASE_0_AUDIT.md`). They must be updated only if an approved architecture changes their *implementation*, never to change locked product behaviour.

---

## Flowchart A — Overall development workflow

```mermaid
flowchart TD
    A[Phase 0: Audit Existing Project] --> B[Report Findings]
    B --> C{Owner Approves Next Step?}
    C -- No --> D[Revise or Investigate]
    D --> B
    C -- Yes --> E[Phase 1: Create Visual UI Options]
    E --> F[Owner Reviews Visual Prototypes]
    F --> G{UI/UX Locked?}
    G -- No --> H[Revise Selected Design]
    H --> F
    G -- Yes --> I[Present Backend Options]
    I --> J{Backend Architecture Approved?}
    J -- No --> K[Revise Recommendation]
    K --> I
    J -- Yes --> L[Implement Approved Frontend]
    L --> M[Test and Review]
    M --> N[Implement Next Approved Phase]
    N --> O[Integration and Security Testing]
    O --> P{Production Approval?}
    P -- No --> Q[Fix Issues and Re-test]
    Q --> O
    P -- Yes --> R[Controlled Deployment and Pilot]
```

**Where we are:** at node **C** (Phase 0 report delivered, awaiting approval).

---

## Flowchart B — Trial and subscription lifecycle

```mermaid
flowchart TD
    A[New Registration] --> B[Create Trial Record]
    B --> C[Enable All Main Features for 10 Days]
    C --> D[Show Trial Countdown and Reminders]
    D --> E{Trial Expired?}
    E -- No --> C
    E -- Yes --> F{Valid Paid Subscription?}
    F -- Yes --> G[Apply Selected Plan Entitlements]
    F -- No --> H[Read-only Existing Data]
    H --> I[Block New Orders and Paid Features]
    I --> J[Preserve Menus Orders and Receipts]
    J --> K[Owner Reactivates Subscription]
    K --> L[Verify Subscription Payment]
    L --> M{Payment Confirmed?}
    M -- No --> H
    M -- Yes --> G
    G --> N[Manage Renewal Cancellation and Plan Changes]
```

**Status:** not implemented. Plan prices locked at ₹899 / ₹1,599 / ₹2,699 per month. Trial = 10 days, all main features, server-side timestamps.

---

## Flowchart C — QR verification and ordering eligibility

```mermaid
flowchart TD
    A[Customer Scans Table QR] --> B[Resolve Restaurant and Table]
    B --> C[Request On-site Verification]
    C --> D[Validate Code Session Expiry and Revocation]
    D --> E{Server Validation Passes?}
    E -- No --> F[Reject Ordering and Explain Recovery]
    E -- Yes --> G[Check Restaurant Table and Ordering Rules]
    G --> H{Ordering Allowed?}
    H -- No --> I[Show Unavailable State]
    H -- Yes --> J[Show Customer Menu]
    J --> K[Build Cart]
    K --> L[Revalidate Cart on Server]
    L --> M{Cart Valid?}
    M -- No --> N[Show Corrections and Recalculate]
    N --> K
    M -- Yes --> O[Choose Payment Method]
```

**Status:** not implemented. Rotating/short-lived on-site code lifecycle to be designed and presented for approval before implementation.

---

## Flowchart D — Checkout and kitchen notification

```mermaid
flowchart TD
    A[Validated Checkout] --> B{Payment Method}
    B -- Online --> C[Create Payment Attempt]
    C --> D[Verify Provider Result on Server]
    D --> E{Payment Verified?}
    E -- No --> F[Keep Order Unconfirmed or Apply Defined Failure State]
    F --> G[Allow Safe Retry or Recovery]
    E -- Yes --> H[Persist Paid Order]
    B -- Pay at Counter --> I[Validate Counter Payment Rules]
    I --> J[Persist Order as Payment Pending]
    H --> K[Commit Durable Order Event]
    J --> K
    K --> L[Kitchen Dashboard Receives Order]
    K --> M[Voice Announcement Queue]
    M --> N{Audio Available?}
    N -- Yes --> O[Speak Order Details]
    N -- No --> P[Keep Order Visible and Record Failure]
    P --> Q[Retry or Replay]
    L --> R[Kitchen Updates Preparation State]
    R --> S[Update Customer Tracking]
```

**Status:** not implemented. No payment provider selected.

---

## Flowchart E — Counter payment and receipt

```mermaid
flowchart TD
    A[Order Payment Pending] --> B[Cashier Opens Order]
    B --> C[Verify Amount and Order]
    C --> D[Receive Payment]
    D --> E[Record Payment with Audit Trail]
    E --> F{Payment Recorded Successfully?}
    F -- No --> G[Show Error and Preserve Pending State]
    F -- Yes --> H[Update Payment Status]
    H --> I[Generate or Update Paid Receipt]
    I --> J[View Digital Receipt]
    I --> K[Print or Save PDF]
```

**Status:** not implemented.

---

## Flowchart F — AI menu import

```mermaid
flowchart TD
    A[Upload Menu Image or PDF] --> B[Validate File and Limits]
    B --> C{File Accepted?}
    C -- No --> D[Explain Error]
    C -- Yes --> E[Store Source Securely]
    E --> F[OCR and Layout Processing]
    F --> G[Extract Menu Draft]
    G --> H[Flag Ambiguous Data]
    H --> I[Owner Reviews and Edits]
    I --> J[Validate Prices Categories and Variants]
    J --> K[Preview Menu and Brand Theme]
    K --> L{Owner Approves?}
    L -- No --> I
    L -- Yes --> M[Publish New Menu Version]
    M --> N[Customer Menu Displays Structured Content]
```

**Status:** not implemented. No OCR tooling installed or evaluated. No accuracy measured — none will be claimed until measured.

---

## Flowchart G — Phase approval and release control

```mermaid
flowchart TD
    A[Finish Current Phase] --> B[Run Relevant Tests]
    B --> C[Report Changed Files and Results]
    C --> D[Document Remaining Risks]
    D --> E{Owner Accepts Phase?}
    E -- No --> F[Correct Issues]
    F --> B
    E -- Yes --> G{Next Phase Requires Critical Decision?}
    G -- Yes --> H[Present Options and Recommendation]
    H --> I[Wait for Explicit Approval]
    I --> J[Proceed Within Approved Scope]
    G -- No --> J
    J --> K{Production or Destructive Action?}
    K -- Yes --> L[Obtain Separate Explicit Approval]
    K -- No --> A
```

**Status:** in effect as the working agreement for this engagement.
