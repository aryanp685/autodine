# Production pending migration manifest

Candidate delta only; not an executable approval or proof of live schema compatibility.

| Migration | SHA-256 | Review markers |
|---|---|---|
| 20261109000100_restore_hold_fields.sql | `0b9ae189c2f47aea6aacc27488fb81439c2996009a8af6be93be8c004af65c7a` | function changes, permissions |
| 20261109000200_order_attempt_lock.sql | `ec029cc6fee516caffaef554e798892ce684989fac41673917a3ee230a9b6b14` | function changes, permissions |
| 20261109000300_payment_state_guards.sql | `db4b979da5aecb20836b0844d49497f3656d85556ecf5e5d4991d1b86e429aff` | function changes, permissions |
| 20261109000400_order_write_boundary.sql | `e604a331a3f0e71850ecb93cc2fdc4266c001773de0af921cc9bd4e8aeead650` | function changes, table/trigger changes, permissions |
| 20261109000500_session_payment_guard.sql | `c73571e7d1055dfd6815e93952122fe51091bae0eba128cc7d58e879c74614f6` | function changes |
| 20261109000600_finalized_source_guard.sql | `95c2823533e2b8e5e8d662d0e86081ea520bf79066ac06aaa59f02ee1009c8e3` | function changes, table/trigger changes, permissions |
| 20261109000700_order_line_removal.sql | `f1201dd01095acdf31ee1eb20f11998ce0f4087b11c7ba5f78a1b727898dc2e1` | function changes |
| 20261109000800_table_activity_summary.sql | `66226b9a9717378d1a53c9e4ccee0f3e8aa869645d45fb0224ff269a6fb9c2ad` | function changes, permissions |
| 20261109000900_staff_tts_budget.sql | `71cd1c7bec6659b93e5244ad9147cee37e7fcb0de98c3fa22c5f1aece6d9d24f` | function changes, permissions |
| 20261109001000_operational_readiness.sql | `aa4f08a7666070443b51f472e48b6d11397178f891768d95f9d9b70efe7cd0d6` | function changes, permissions |
| 20261110000100_counter_payment_lock_order.sql | `c592c4ab1f3065775b229fc35e3fc62b389aedfa53a37c7225ac8c3390109363` | function changes |
| 20261110000200_financial_session_serialization.sql | `eb1173128cdc88cf87af696b337df9041fd58f11e49fd8e56cb2518e6374287d` | function changes |
| 20261110000300_shared_wifi_scan_limits.sql | `0b8092fb4ec7dfd442866bc8b802b031edc99a2b6a465ba4972ffd10f45882c2` | function changes |
| 20261110000400_durable_order_attempt_budget.sql | `ab648932e0e84a898936c002e6dbf86f4625ba7f9856e3f3b03b4c25fd903f0b` | function changes, permissions |

## Gates

- Reconcile live function definitions/ACLs and prerequisite columns against these files; do not infer compatibility from ledger alone.
- Confirm hosted backup freshness and restore access.
- Establish ordering/RPC admission gate and drain before incompatible contract cutover.
- Deploy matching app; do not independently roll back app or DB.
- Independent review and hosted REST persistence verification remain outstanding.
- No production customer-data load/soak tests or synthetic payments.

## Read-only prerequisite sample

Production catalog inspection confirmed all seven sampled columns exist:
orders.hold_required, orders.confirmed_at, orders.order_session_id,
order_sessions.paid_at, restaurant_invoices.invoice_number,
restaurant_payment_receipts.snapshot, kitchen_announcement_claims.order_id.
No tenant records were retrieved. This is only a sampled structural check, not
complete validation of the 14-migration delta or financial data invariants.
