-- ============================================================================
-- The accent a NEW restaurant starts with.
--
-- WHY THIS EXISTS
--
-- The guest flow was redesigned around a warm cream surface with a wine-dark
-- accent (maroon). The column default was still 'forest', a green chosen for
-- the older flat-white design, so every restaurant created from here on would
-- begin in a colour the product no longer leads with -- and would look
-- different from the demo and the screenshots.
--
-- WHAT IT DOES NOT DO
--
-- It does not touch a single existing row. An owner who chose forest, or
-- terracotta, or anything else, keeps it: re-colouring somebody's restaurant
-- because the product changed its mind is not a migration, it is an edit to
-- their branding. Only the DEFAULT for future inserts moves.
--
-- Safe to run more than once. Reversible with:
--   alter table public.restaurants alter column accent set default 'forest';
-- ============================================================================

alter table public.restaurants
  alter column accent set default 'maroon';

comment on column public.restaurants.accent is
  'Guest-flow palette key (see lib/branding/palette.ts). Default maroon; the CHECK constraint lists every key this build can render.';
