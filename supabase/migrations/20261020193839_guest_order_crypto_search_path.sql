-- Supabase installs pgcrypto in the locked-down `extensions` schema. The guest
-- place_order function calls digest() while running as SECURITY DEFINER, so
-- include that trusted schema in its pinned search_path. Anon, authenticated,
-- and service_role cannot CREATE objects in either searched schema.
alter function public.place_order(text, jsonb, text)
  set search_path = public, extensions, pg_temp;
