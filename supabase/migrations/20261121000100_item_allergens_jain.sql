-- India UX: allergen + Jain markers on items.
-- Additive only. Nullable; no defaults assumed.

alter table public.items add column if not exists is_jain boolean;
alter table public.items add column if not exists allergens text[];

comment on column public.items.is_jain is
  'TRUE = marked Jain, FALSE = not, NULL = unmarked.';
comment on column public.items.allergens is
  'Free-text allergen tags declared by the restaurant. NULL = none declared.';

alter table public.order_items add column if not exists is_jain boolean;
alter table public.order_items add column if not exists allergens text[];
