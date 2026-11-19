-- Restore the P8 settlement boundary that 20261114000101 loosened.
--
-- issue_closed_session_receipt() issues a document for an already-closed
-- sitting. It does not collect payment and must not be a client entry point:
-- close_order_session_and_issue_receipt() is the settlement-checked wrapper,
-- and as a SECURITY DEFINER function it can call the helper without granting
-- EXECUTE to authenticated users. Granting the helper directly let an
-- authenticated client skip the wrapper's outstanding-balance check for a
-- session it could get into the closed state.
--
-- This is a forward-only correction; 20261114000101 remains in the chain.

revoke all on function public.issue_closed_session_receipt(uuid, jsonb)
  from public, anon, authenticated, service_role;
