-- The live order_sessions migration (20261107074545) installed a membership-
-- scoped SELECT policy but revoked the authenticated role's table privilege.
-- Policies filter rows; they do not grant table privileges. Staff screens use
-- the user's authenticated client, so grant SELECT only. No client write
-- privileges are added. This permission was applied directly to production
-- and is now represented in migration history for future environments.
grant select on public.order_sessions to authenticated;
