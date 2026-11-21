/**
 * Loading what the translator needs: the menu's rows and their saved
 * translations.
 *
 * Same remembered-menu rule as the editor — the translation screen works on
 * the menu the owner is editing, so switching menus in the editor switches
 * the translator too, without threading ids through links. Rows are read
 * WITH their translations column; the originals are what the review shows
 * beside the translated text, and the originals are never written here.
 */

import { cookies } from 'next/headers';
import { chooseMenu } from '@/lib/menu-select';
import { getStaffContextDetailed } from './staff';
import { EDITOR_MENU_COOKIE } from './menu-editor';
import type { TranslationMap } from '@/lib/i18n/translations';

export type TranslateCategoryRow = {
  id: string;
  name: string;
  translations: TranslationMap;
};

export type TranslateItemRow = {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  pricePaise: number;
  translations: TranslationMap;
};

export type TranslateData = {
  restaurantName: string;
  menuId: string;
  menuName: string;
  categories: TranslateCategoryRow[];
  items: TranslateItemRow[];
};

async function readRememberedMenu(): Promise<string | null> {
  try {
    return (await cookies()).get(EDITOR_MENU_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

export async function getTranslateData(): Promise<TranslateData | null> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return null;

  const { supabase, restaurantId, restaurantName } = staff.context;

  const { data: menuRows, error: menuError } = await supabase
    .from('menus')
    .select('id, name, is_published, sort_order')
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (menuError) throw new Error(`Could not load menus: ${menuError.message}`);

  const allMenus = (menuRows ?? []) as { id: string; name: string }[];
  if (allMenus.length === 0) return null;

  const remembered = await readRememberedMenu();
  const menu = chooseMenu(allMenus, remembered) ?? allMenus[0];

  const [categoriesResult, itemsResult] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, translations')
      .eq('restaurant_id', restaurantId)
      .eq('menu_id', menu.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('items')
      .select('id, name, description, category_id, price_paise, translations')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);

  if (categoriesResult.error) {
    throw new Error(`Could not load categories: ${categoriesResult.error.message}`);
  }
  if (itemsResult.error) {
    throw new Error(`Could not load items: ${itemsResult.error.message}`);
  }

  const categoryRows = (categoriesResult.data ?? []) as {
    id: string;
    name: string;
    translations: TranslationMap | null;
  }[];

  const itemRows = (itemsResult.data ?? []) as {
    id: string;
    name: string;
    description: string | null;
    category_id: string | null;
    price_paise: number;
    translations: TranslationMap | null;
  }[];

  return {
    restaurantName,
    menuId: menu.id as string,
    menuName: menu.name as string,
    categories: categoryRows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      translations: row.translations ?? {},
    })),
    items: itemRows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      description: row.description ?? '',
      categoryId: row.category_id ?? '',
      pricePaise: row.price_paise,
      translations: row.translations ?? {},
    })),
  };
}
