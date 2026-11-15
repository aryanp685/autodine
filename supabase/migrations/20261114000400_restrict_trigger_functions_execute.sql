-- 20261114000400 — Revoke EXECUTE on every SECURITY DEFINER trigger function.
--
-- PostgreSQL does not consult the EXECUTE privilege when a function is invoked
-- by the trigger mechanism. This was verified on the local embedded cluster:
-- a SECURITY DEFINER trigger function with EXECUTE revoked from public, anon,
-- authenticated and service_role still fired (see
-- scripts/local-pg/probe-trigger-execute.mjs). Direct calls from application
-- roles therefore buy an attacker nothing today, but they do expose the
-- functions to the PostgREST RPC catalogue and to linter noise, and they would
-- become meaningful if a trigger body were ever refactored to be separately
-- callable. The safe state is: EXECUTE not granted to any runtime role.
--
-- These functions remain owned by the migration role; trigger firing and the
-- function owner are unaffected. No data, policy, grant or non-trigger
-- function changes here. Idempotent: REVOKE of a privilege not held is a
-- no-op in PostgreSQL.

revoke all on function public.audit_staff_invite_change()          from public, anon, authenticated, service_role;
revoke all on function public.audit_staff_membership_change()       from public, anon, authenticated, service_role;
revoke all on function public.ensure_table_qr_code()                 from public, anon, authenticated, service_role;
revoke all on function public.issue_payment_receipt_after_invoice_payment() from public, anon, authenticated, service_role;
revoke all on function public.prevent_restaurant_account_reassignment() from public, anon, authenticated, service_role;
revoke all on function public.protect_account_plan()                from public, anon, authenticated, service_role;
revoke all on function public.protect_billing_history()             from public, anon, authenticated, service_role;
revoke all on function public.protect_restaurant_plan()             from public, anon, authenticated, service_role;
revoke all on function public.protect_webhook_evidence()            from public, anon, authenticated, service_role;
revoke all on function public.reject_alcohol_straddle_composition() from public, anon, authenticated, service_role;
revoke all on function public.restaurant_gst_config_history_track() from public, anon, authenticated, service_role;
revoke all on function public.restaurant_gst_config_shared_identity() from public, anon, authenticated, service_role;
revoke all on function public.restaurant_gst_config_version()       from public, anon, authenticated, service_role;
