/**
 * Menu editing: save an item, add one, flip availability, publish the menu.
 *
 * Same security shape as the table actions: the restaurant id comes from the
 * session's membership row, never from the form, so a forged payload cannot
 * reach another tenant's rows even though RLS would already block it.
 *
 * Prices are accepted in RUPEES because that is what the locked editor shows,
 * and converted to paise here, at the boundary. Storing a float rupee amount
 * would reintroduce the rounding bug that lib/money.ts exists to prevent.
 *
 * Publishing is deliberately separate from saving. An owner can save drafts
 * all day without diners seeing them; is_published is the single switch that
 * makes a menu public, and it is the one write this file treats as sensitive.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { rupeesToPaise } from '@/lib/money';
import { PRESET_CATEGORIES, normaliseCategoryName } from '@/lib/menu-presets';

const MENUS_PATH = '/dashboard/menus';

function fail(message: string): never {
  redirect(`${MENUS_PATH}?error=${encodeURIComponent(message)}`);
}

async function currentRestaurant() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership, error } = await supabase
    .from('memberships')
    .select('restaurant_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (error || !membership) return null;
  return { supabase, restaurantId: membership.restaurant_id as string };
}

function ok(message: string): never {
  revalidatePath(MENUS_PATH);
  redirect(`${MENUS_PATH}?notice=${encodeURIComponent(message)}`);
}

type Ctx = NonNullable<Awaited<ReturnType<typeof currentRestaurant>>>;

/**
 * Confirm a category id submitted by the editor belongs to this restaurant.
 *
 * RLS already blocks a foreign id -- categories_staff_insert and _update both
 * carry a WITH CHECK on has_restaurant_role() -- but it fails as a generic
 * "new row violates row-level security policy", which tells an owner nothing.
 * Checking first turns a forged or stale id into a message they can act on.
 *
 * Returns null when the editor sent no category at all, which is a different
 * situation from sending a bad one: no category means "leave it alone".
 */
async function resolveCategoryId(ctx: Ctx, raw: FormDataEntryValue | null): Promise<string | null> {
  const id = String(raw ?? '').trim();
  if (!id) return null;

  const { data, error } = await ctx.supabase
    .from('categories')
    .select('id')
    .eq('id', id)
    .eq('restaurant_id', ctx.restaurantId)
    .maybeSingle();

  if (error || !data) {
    fail('That category is no longer on your menu. Reload the page and try again.');
  }
  return data.id as string;
}

export async function addCategoryAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const name = String(formData.get('name') ?? '').trim();
  const menuId = String(formData.get('menuId') ?? '').trim();

  if (!name) fail('A category needs a name.');
  if (name.length > 60) fail('That category name is too long.');
  if (!menuId) fail('There is no menu to add this category to.');

  // The menu matters as much as the name. A category whose menu_id is NULL is
  // unreachable from items_public, so every item put in it would be invisible
  // to diners -- the exact failure this whole action exists to prevent.
  const { data: menu, error: menuError } = await ctx.supabase
    .from('menus')
    .select('id')
    .eq('id', menuId)
    .eq('restaurant_id', ctx.restaurantId)
    .maybeSingle();

  if (menuError || !menu) fail('That menu is not on your account.');

  const { count } = await ctx.supabase
    .from('categories')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', ctx.restaurantId);

  const { error } = await ctx.supabase.from('categories').insert({
    restaurant_id: ctx.restaurantId,
    menu_id: menuId,
    name,
    sort_order: count ?? 0,
  });

  if (error) fail(`Could not add the category: ${error.message}`);

  ok(`Category "${name}" added.`);
}

/**
 * Seed the categories nearly every Indian restaurant uses, in one action.
 *
 * Without this, going from an empty menu to a first item meant typing each
 * category name by hand first. The chips add one at a time, but the common
 * case is wanting all of them, so that is one press.
 *
 * Names already present are skipped, so pressing it twice changes nothing
 * rather than creating duplicates.
 */
export async function addPresetCategoriesAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const menuId = String(formData.get('menuId') ?? '').trim();
  if (!menuId) fail('There is no menu to add categories to.');

  const { data: menu, error: menuError } = await ctx.supabase
    .from('menus')
    .select('id')
    .eq('id', menuId)
    .eq('restaurant_id', ctx.restaurantId)
    .maybeSingle();

  if (menuError || !menu) fail('That menu is not on your account.');

  const { data: existing } = await ctx.supabase
    .from('categories')
    .select('name')
    .eq('restaurant_id', ctx.restaurantId);

  const have = new Set((existing ?? []).map((c) => normaliseCategoryName(c.name)));
  const missing = PRESET_CATEGORIES.filter((n) => !have.has(normaliseCategoryName(n)));

  if (missing.length === 0) {
    ok('Those categories are already on your menu.');
  }

  const { count } = await ctx.supabase
    .from('categories')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', ctx.restaurantId);

  const { error } = await ctx.supabase.from('categories').insert(
    missing.map((name, i) => ({
      restaurant_id: ctx.restaurantId,
      menu_id: menuId,
      name,
      sort_order: (count ?? 0) + i,
    }))
  );

  if (error) fail(`Could not add the categories: ${error.message}`);

  ok(`Added ${missing.length} categor${missing.length === 1 ? 'y' : 'ies'}.`);
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const categoryId = String(formData.get('categoryId') ?? '').trim();
  if (!categoryId) fail('No category selected.');

  // Refuse rather than orphan. Deleting a category that still holds items
  // would either fail on a foreign key or, worse, silently strand those items
  // in a state where they exist but can never be shown to a diner.
  const { count, error: countError } = await ctx.supabase
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId)
    .eq('restaurant_id', ctx.restaurantId);

  if (countError) fail(`Could not check that category: ${countError.message}`);
  if ((count ?? 0) > 0) {
    fail('Move or delete the items in this category first.');
  }

  const { error } = await ctx.supabase
    .from('categories')
    .delete()
    .eq('id', categoryId)
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not delete the category: ${error.message}`);

  ok('Category deleted.');
}

export async function saveItemAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const itemId = String(formData.get('itemId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const desc = String(formData.get('description') ?? '').trim();
  const veg = formData.get('veg') === 'veg';
  const rawPrice = String(formData.get('price') ?? '').trim();
  const categoryId = await resolveCategoryId(ctx, formData.get('categoryId'));

  if (!itemId) fail('No item selected.');
  if (!name) fail('An item needs a name.');

  const rupees = Number(rawPrice);
  if (!Number.isFinite(rupees) || rupees < 0) fail('Price must be a number.');
  if (rupees > 100000) fail('That price looks wrong. Please check it.');

  const { error } = await ctx.supabase
    .from('items')
    .update({
      name,
      description: desc || null,
      price_paise: rupeesToPaise(rupees),
      is_veg: veg,
      ...(categoryId ? { category_id: categoryId } : {}),
    })
    .eq('id', itemId)
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not save the item: ${error.message}`);

  ok('Draft saved. Diners will not see it until you publish.');
}

export async function addItemAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  // No placeholder fallback. Defaulting to "New item" at zero rupees meant
  // every press created a blank row the owner then had to reopen and retype,
  // so a few quick clicks left a table of identical rows that differed only
  // by id. The form now carries the real values, so an empty name is an
  // error rather than something to fill in later.
  const name = String(formData.get('name') ?? '').trim();
  if (!name) fail('Give the item a name.');
  if (name.length > 120) fail('That item name is too long.');

  const rupees = Number(String(formData.get('price') ?? '0').trim());
  const safePrice = Number.isFinite(rupees) && rupees >= 0 ? rupees : 0;

  const isVeg = String(formData.get('veg') ?? 'veg').trim() !== 'non';

  // Required, not optional. categories_id is the join that makes an item
  // visible to diners: the items_public RLS policy reaches an item only
  // through its category and that category's published menu. An item saved
  // with a NULL category would sit in the editor looking saved and correct
  // while being invisible on the customer menu -- and the owner would have no
  // way to see why.
  const categoryId = await resolveCategoryId(ctx, formData.get('categoryId'));
  if (!categoryId) {
    fail('Add a category first. Diners see items through their category.');
  }

  const { error } = await ctx.supabase.from('items').insert({
    restaurant_id: ctx.restaurantId,
    category_id: categoryId,
    name,
    description: null,
    price_paise: rupeesToPaise(safePrice),
    is_veg: isVeg,
    is_available: true,
    sort_order: 0,
  });

  if (error) fail(`Could not add the item: ${error.message}`);

  ok(`"${name}" added.`);
}

export async function setAllAvailabilityAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const available = formData.get('available') === 'true';

  const { error } = await ctx.supabase
    .from('items')
    .update({ is_available: available })
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not update availability: ${error.message}`);

  ok(
    available
      ? 'Every item is now available.'
      : 'Every item is now marked unavailable. Diners will see an empty menu.'
  );
}

export async function publishMenuAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to publish the menu.');

  const menuId = String(formData.get('menuId') ?? '').trim();
  if (!menuId) fail('No menu to publish.');

  // Publishing used to be one-way. An owner whose menu was already live saw a
  // disabled button labelled "Published" and no way to take it down, which
  // read as broken. One flag, both directions.
  const published = String(formData.get('published') ?? 'true').trim() !== 'false';

  const { error } = await ctx.supabase
    .from('menus')
    .update({ is_published: published })
    .eq('id', menuId)
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not ${published ? 'publish' : 'unpublish'}: ${error.message}`);

  ok(
    published
      ? 'Menu published. Diners can see it now.'
      : 'Menu unpublished. Diners see a closed menu.'
  );
}
