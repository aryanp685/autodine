-- How a dish is SAID, when the algorithm's guess is wrong.
--
-- The kitchen board turns a menu name into Devanagari (lib/hindi.ts) so that
-- every Hindi voice can read it. A dictionary of Indian menu vocabulary plus
-- rules for imported food gets most names right and never leaves Latin script
-- in front of the voice -- but "right" for a dish nobody has heard of is a
-- guess, and the person who knows the answer is the owner.
--
-- So an item may carry its own written pronunciation. Whatever is stored here
-- is what the kitchen hears; the name keeps being what the guest reads on the
-- menu. Both are needed: renaming a dish to make the voice happy would be a
-- strange thing to force on a restaurant.
--
-- Null is the normal state -- it means "say the name, the way the board
-- already does". The column is text rather than a lookup table because it is
-- one string per item, edited next to the name it replaces.

alter table public.items
  add column if not exists spoken_name text;

-- Bounded to what a person can hear in one breath, and the same bound the
-- editor enforces. A pronunciation is a phrase, not a paragraph.
alter table public.items
  drop constraint if exists items_spoken_name_length;

alter table public.items
  add constraint items_spoken_name_length
  check (spoken_name is null or (char_length(btrim(spoken_name)) between 1 and 120));
