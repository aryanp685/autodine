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
import { readUndoItem } from '@/lib/menu-undo';
import type { UndoItem } from '@/lib/menu-undo';

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

export async function deleteItemAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const itemId = String(formData.get('itemId') ?? '').trim();
  if (!itemId) fail('No item selected.');

  // Read it back before deleting. The undo has to be able to put the row back
  // exactly as it was -- same id, same category, same price -- so the snapshot
  // is taken from the row, not from anything the form claimed about it.
  const { data: row, error: readError } = await ctx.supabase
    .from('items')
    .select('id, name, description, price_paise, is_veg, is_available, category_id, sort_order')
    .eq('id', itemId)
    .eq('restaurant_id', ctx.restaurantId)
    .maybeSingle();

  if (readError || !row) fail('That item is no longer on your menu.');

  const { error } = await ctx.supabase
    .from('items')
    .delete()
    .eq('id', itemId)
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not delete the item: ${error.message}`);

  // Past orders are safe. order_items.item_id is ON DELETE SET NULL and every
  // order item keeps its own snapshot of the name and price, so removing an
  // item from the menu does not rewrite what a customer was already served.
  const undo: UndoItem = {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    pricePaise: Number(row.price_paise ?? 0),
    isVeg: Boolean(row.is_veg),
    isAvailable: Boolean(row.is_available),
    categoryId: (row.category_id as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
  };

  revalidatePath(MENUS_PATH);
  redirect(
    `${MENUS_PATH}?notice=${encodeURIComponent(`"${undo.name}" deleted.`)}` +
      `&undo=${encodeURIComponent(JSON.stringify(undo))}`
  );
}

export async function restoreItemAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const raw = String(formData.get('undo') ?? '').trim();
  if (!raw) fail('Nothing to undo.');

  // JSON.parse throws on anything that is not JSON, and a stale or hand-edited
  // link is the common case here rather than an exceptional one.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('That undo has expired. Add the item again if you still want it.');
  }

  const item = readUndoItem(parsed);
  if (!item) fail('That undo has expired. Add the item again if you still want it.');

  // Already back -- a double press, or the owner re-added it by hand. Inserting
  // again would collide on the primary key and surface as a raw database error.
  const { data: existing } = await ctx.supabase
    .from('items')
    .select('id')
    .eq('id', item.id)
    .maybeSingle();

  if (existing) ok(`"${item.name}" is already back on the menu.`);

  const { error } = await ctx.supabase.from('items').insert({
    id: item.id,
    restaurant_id: ctx.restaurantId,
    category_id: item.categoryId,
    name: item.name,
    description: item.description,
    price_paise: item.pricePaise,
    is_veg: item.isVeg,
    is_available: item.isAvailable,
    sort_order: item.sortOrder,
  });

  if (error) fail(`Could not put the item back: ${error.message}`);

  ok(`"${item.name}" is back.`);
}

export async function saveItemAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const itemId = String(formData.get('itemId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const desc = String(formData.get('description') ?? '').trim();
  const veg = formData.get('veg') === 'veg';
  const spokenName = String(formData.get('spokenName') ?? '').trim();
  const rawPrice = String(formData.get('price') ?? '').trim();
  const categoryId = await resolveCategoryId(ctx, formData.get('categoryId'));

  if (!itemId) fail('No item selected.');
  if (!name) fail('An item needs a name.');
  if (spokenName.length > 120) fail('That spoken name is too long to say in one breath.');

  const rupees = Number(rawPrice);
  if (!Number.isFinite(rupees) || rupees < 0) fail('Price must be a number.');
  if (rupees > 100000) fail('That price looks wrong. Please check it.');

  const { error } = await ctx.supabase
    .from('items')
    .update({
      name,
      description: desc || null,
      // Empty means "say the name": the board generates the pronunciation
      // itself, and storing '' would be a pronunciation of nothing.
      spoken_name: spokenName || null,
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

/* ============================================================================
   Portions
   ========================================================================== */

/**
 * Confirm an item id submitted by the editor belongs to this restaurant.
 *
 * Same reasoning as resolveCategoryId: RLS would block a foreign id, but it
 * fails as a generic policy violation that tells the owner nothing. Checking
 * first turns a stale or forged id into a sentence they can act on.
 */
async function requireOwnItem(ctx: Ctx, raw: FormDataEntryValue | null): Promise<string> {
  const itemId = String(raw ?? '').trim();
  if (!itemId) fail('No item selected.');

  const { data, error } = await ctx.supabase
    .from('items')
    .select('id')
    .eq('id', itemId)
    .eq('restaurant_id', ctx.restaurantId)
    .maybeSingle();

  if (error || !data) {
    fail('That item is not on your menu. Reload the page and try again.');
  }
  return data.id as string;
}

/**
 * Add a portion to a dish.
 *
 * A portion is a name and a price. The name has to be short: it is printed on
 * the kitchen ticket and shown on the bill after the dish name, so "Half
 * (suitable for one, served with rice)" is not a portion name, it is a
 * description in the wrong field.
 */
export async function addVariantAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const itemId = await requireOwnItem(ctx, formData.get('itemId'));

  const name = String(formData.get('variantName') ?? '').trim();
  if (!name) fail('Give the portion a name, such as Half or Full.');
  if (name.length > 40) fail('That portion name is too long. Keep it to 40 characters.');

  const rupees = Number(String(formData.get('variantPrice') ?? '').trim());
  if (!Number.isFinite(rupees) || rupees < 0) fail('The portion price must be a number.');
  if (rupees > 100000) fail('That price looks wrong. Please check it.');

  // Appended at the end, so the order the owner adds portions in is the order
  // diners see them in.
  const { data: existing, error: readError } = await ctx.supabase
    .from('item_variants')
    .select('sort_order')
    .eq('item_id', itemId)
    .order('sort_order', { ascending: false })
    .limit(1);

  if (readError) fail(`Could not read the portions: ${readError.message}`);

  const nextOrder = ((existing?.[0]?.sort_order as number | undefined) ?? 0) + 1;

  const { error } = await ctx.supabase.from('item_variants').insert({
    item_id: itemId,
    name,
    price_paise: rupeesToPaise(rupees),
    sort_order: nextOrder,
  });

  if (error) fail(`Could not add the portion: ${error.message}`);

  ok(`"${name}" added at ₹${rupees}. Publish the menu and diners will see it.`);
}

/**
 * Remove a portion.
 *
 * A hard delete, like an item delete, and for the same reason: a portion that
 * is visible in the editor but not on the menu is a state the owner cannot
 * explain. Orders already placed are unaffected -- order_items carries a
 * snapshot of the portion name and its price at the time of the order, so a
 * past bill still reads correctly after this.
 */
export async function deleteVariantAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const variantId = String(formData.get('variantId') ?? '').trim();
  if (!variantId) fail('No portion selected.');

  // Resolve the portion's dish, then prove the dish is ours. A direct delete
  // scoped by id alone would rely on the RLS policy to reject a foreign id,
  // and the failure would be a policy violation the owner cannot interpret.
  const { data: variant, error: readError } = await ctx.supabase
    .from('item_variants')
    .select('id, item_id, name')
    .eq('id', variantId)
    .maybeSingle();

  if (readError) fail(`Could not read that portion: ${readError.message}`);
  if (!variant) fail('That portion is already gone.');

  const itemId = await requireOwnItem(ctx, variant.item_id as string);

  const { error } = await ctx.supabase
    .from('item_variants')
    .delete()
    .eq('id', variantId)
    .eq('item_id', itemId);

  if (error) fail(`Could not remove the portion: ${error.message}`);

  ok(`"${variant.name as string}" removed. Past orders keep their own record of it.`);
}

/* ============================================================================
   Add-ons
   ========================================================================== */

/**
 * Add a group of choices to a dish -- "Add a little extra", "Jain / no onion".
 *
 * A group is the unit because the limit lives there: three sauces sharing
 * "pick up to 2" is one decision, not three. Making options required is done
 * by saying so here rather than by hiding the skip button in the UI, because
 * the guest sheet and the kitchen both read this row.
 */
export async function addAddonGroupAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const itemId = await requireOwnItem(ctx, formData.get('itemId'));

  const name = String(formData.get('groupName') ?? '').trim();
  if (!name) fail('Give the add-on group a name, such as "Add a little extra".');
  if (name.length > 60) fail('That group name is too long. Keep it to 60 characters.');

  // Anything other than an explicit "yes" means the guest may skip it, which
  // is both the common case and the safe default: a group nobody can skip is
  // a way to lose an order.
  const required = formData.get('required') === 'yes';
  const minSelect = required ? 1 : 0;

  const rawMax = Number(String(formData.get('maxSelect') ?? '1').trim());
  const maxSelect = Number.isFinite(rawMax) ? Math.min(Math.max(Math.round(rawMax), 1), 10) : 1;

  const { data: existing, error: readError } = await ctx.supabase
    .from('item_addon_groups')
    .select('sort_order')
    .eq('item_id', itemId)
    .order('sort_order', { ascending: false })
    .limit(1);

  if (readError) fail(`Could not read the add-on groups: ${readError.message}`);

  const nextOrder = ((existing?.[0]?.sort_order as number | undefined) ?? 0) + 1;

  const { error } = await ctx.supabase.from('item_addon_groups').insert({
    item_id: itemId,
    name,
    min_select: minSelect,
    max_select: maxSelect,
    sort_order: nextOrder,
  });

  if (error) fail(`Could not add the group: ${error.message}`);

  ok(`"${name}" added. Now give it its choices.`);
}

/**
 * Remove a group, and every choice in it.
 *
 * A hard delete like a portion, and for the same reason: a group that shows
 * in the editor but not on the menu is a state the owner cannot explain.
 * Orders already placed keep the names they were sold with, because
 * order_items stores its own snapshot.
 */
export async function deleteAddonGroupAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const groupId = String(formData.get('groupId') ?? '').trim();
  if (!groupId) fail('No add-on group selected.');

  const { data: group, error: readError } = await ctx.supabase
    .from('item_addon_groups')
    .select('id, item_id, name')
    .eq('id', groupId)
    .maybeSingle();

  if (readError) fail(`Could not read that group: ${readError.message}`);
  if (!group) fail('That add-on group is already gone.');

  await requireOwnItem(ctx, group.item_id as string);

  const { error } = await ctx.supabase
    .from('item_addon_groups')
    .delete()
    .eq('id', groupId)
    .eq('item_id', group.item_id as string);

  if (error) fail(`Could not remove the group: ${error.message}`);

  ok(`"${group.name as string}" removed. Past orders keep their own record of it.`);
}

/** Add one choice to a group: a name and what it costs per plate. */
export async function addAddonAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const groupId = String(formData.get('groupId') ?? '').trim();
  if (!groupId) fail('No add-on group selected.');

  const { data: group, error: groupError } = await ctx.supabase
    .from('item_addon_groups')
    .select('id, item_id')
    .eq('id', groupId)
    .maybeSingle();

  if (groupError) fail(`Could not read that group: ${groupError.message}`);
  if (!group) fail('That add-on group is no longer on this dish.');

  await requireOwnItem(ctx, group.item_id as string);

  const name = String(formData.get('addonName') ?? '').trim();
  if (!name) fail('Give the add-on a name, such as "Extra cheese".');
  if (name.length > 40) fail('That add-on name is too long. Keep it to 40 characters.');

  // A blank price means free, not unknown. "Jain" is the case: an instruction
  // the kitchen must see that costs nothing.
  const rawPrice = String(formData.get('addonPrice') ?? '').trim();
  const rupees = rawPrice === '' ? 0 : Number(rawPrice);
  if (!Number.isFinite(rupees) || rupees < 0) fail('The add-on price must be a number.');
  if (rupees > 100000) fail('That price looks wrong. Please check it.');

  const { data: existing, error: readError } = await ctx.supabase
    .from('item_addons')
    .select('sort_order')
    .eq('group_id', groupId)
    .order('sort_order', { ascending: false })
    .limit(1);

  if (readError) fail(`Could not read the add-ons: ${readError.message}`);

  const nextOrder = ((existing?.[0]?.sort_order as number | undefined) ?? 0) + 1;

  const { error } = await ctx.supabase.from('item_addons').insert({
    group_id: groupId,
    name,
    price_paise: rupeesToPaise(rupees),
    sort_order: nextOrder,
  });

  if (error) fail(`Could not add the choice: ${error.message}`);

  ok(
    `"${name}" ${rupees > 0 ? `at ₹${rupees}` : 'at no charge'} added. ` +
      'Diners see it once the menu is published.'
  );
}

/** Remove one choice. Past orders keep the copy they were sold with. */
export async function deleteAddonAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const addonId = String(formData.get('addonId') ?? '').trim();
  if (!addonId) fail('No add-on selected.');

  const { data: addon, error: readError } = await ctx.supabase
    .from('item_addons')
    .select('id, group_id, name')
    .eq('id', addonId)
    .maybeSingle();

  if (readError) fail(`Could not read that add-on: ${readError.message}`);
  if (!addon) fail('That add-on is already gone.');

  // Prove the group -- and through it the dish -- is ours before deleting.
  const { data: group } = await ctx.supabase
    .from('item_addon_groups')
    .select('id, item_id')
    .eq('id', addon.group_id as string)
    .maybeSingle();

  if (!group) fail('That add-on group is no longer on your menu.');
  await requireOwnItem(ctx, group.item_id as string);

  const { error } = await ctx.supabase
    .from('item_addons')
    .delete()
    .eq('id', addonId)
    .eq('group_id', addon.group_id as string);

  if (error) fail(`Could not remove the add-on: ${error.message}`);

  ok(`"${addon.name as string}" removed. Past orders keep their own record of it.`);
}
