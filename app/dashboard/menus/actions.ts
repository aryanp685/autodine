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

export async function saveItemAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const itemId = String(formData.get('itemId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const desc = String(formData.get('description') ?? '').trim();
  const veg = formData.get('veg') === 'veg';
  const rawPrice = String(formData.get('price') ?? '').trim();

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
    })
    .eq('id', itemId)
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not save the item: ${error.message}`);

  ok('Draft saved. Diners will not see it until you publish.');
}

export async function addItemAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to edit the menu.');

  const name = String(formData.get('name') ?? '').trim() || 'New item';
  const rupees = Number(String(formData.get('price') ?? '0').trim());
  const safePrice = Number.isFinite(rupees) && rupees >= 0 ? rupees : 0;

  const { error } = await ctx.supabase.from('items').insert({
    restaurant_id: ctx.restaurantId,
    name,
    description: null,
    price_paise: rupeesToPaise(safePrice),
    is_veg: true,
    is_available: true,
    sort_order: 0,
  });

  if (error) fail(`Could not add the item: ${error.message}`);

  ok(`"${name}" added as a draft.`);
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

  const { error } = await ctx.supabase
    .from('menus')
    .update({ is_published: true })
    .eq('id', menuId)
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not publish: ${error.message}`);

  ok('Menu published. Diners can see it now.');
}
