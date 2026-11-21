-- R3, part 2: menu translations.
--
-- Per-item and per-category language data, stored beside the original and
-- never in place of it. The original name and description stay the source of
-- truth; a translation is a separate entry carrying its own approval and a
-- hash of the source text it was made from, so a menu update makes the old
-- translation visibly outdated instead of silently stale. The guest screen
-- shows a translation only while it is approved AND its hash still matches;
-- otherwise it falls back to the original — never blank, never mixed-up
-- language. Guests read these columns through the existing items_public /
-- categories_public policies (row level); only restaurant writes change them.

alter table public.items
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.categories
  add column if not exists translations jsonb not null default '{}'::jsonb;
