/**
 * Importing a menu that already exists on paper.
 *
 * THE SHAPE OF THE FLOW
 *
 *   preview  paste -> draft (nothing written)
 *   create   draft -> a new DRAFT menu, categories, dishes
 *
 * Nothing is written until the owner presses the second button, and what is
 * written is a draft menu: a half-checked import that goes live immediately
 * would be a menu guests see, and the owner would not know which tap did it.
 *
 * THE DRAFT COMES BACK FROM THE BROWSER
 *
 * So it is user input like any form field: sanitiseDraft() re-checks every
 * name, price and count before an insert. This file never trusts the shape it
 * is handed, even though this morning it produced that shape itself.
 *
 * Restaurant id, again, comes from the membership row through the shared staff
 * context -- never from the payload.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { EDITOR_MENU_COOKIE } from '@/lib/db/menu-editor';
import { extractMenuWithAi, menuAiConfigured } from '@/lib/ai/menu-extract';
import {
  MAX_IMPORT_TEXT,
  draftItemCount,
  parseMenuText,
  sanitiseDraft,
  type MenuImportDraft,
} from '@/lib/menu-import';

const MENUS_PATH = '/dashboard/menus';

export type ImportPreview =
  | { ok: true; draft: MenuImportDraft; source: 'ai' | 'rules'; note?: string }
  | { ok: false; error: string };

/**
 * Read the pasted text. Writes nothing.
 *
 * The model is tried first when it is configured, because it handles the
 * messy pastes (two prices on a line, a photo caption, a table pasted out of
 * a PDF) that rules get wrong. If it is not configured, or it fails, the rule
 * parser runs and `source` says which one produced the draft.
 */
export async function previewMenuImportAction(text: string): Promise<ImportPreview> {
  const raw = String(text ?? '').trim();
  if (raw.length < 10) return { ok: false, error: 'Paste the menu text first.' };
  if (raw.length > MAX_IMPORT_TEXT) {
    return { ok: false, error: `That is longer than one paste can hold. Split it into parts under ${MAX_IMPORT_TEXT} characters.` };
  }

  let note: string | undefined;

  if (menuAiConfigured()) {
    const ai = await extractMenuWithAi(raw);

    if (ai.ok) {
      /**
       * The model is told to leave out a dish it cannot price, which means it
       * can silently read fewer dishes than the paste contains. The rules are
       * run as a second opinion: when they find MORE priced lines than the
       * model returned, the owner is told to check, because a paste that lost
       * four dishes on the way in is the failure this screen exists to stop.
       */
      const lineCount = draftItemCount(parseMenuText(raw));
      const aiCount = draftItemCount(ai.draft);
      const missing = lineCount - aiCount;

      const coverage =
        missing > 0
          ? ` The line parser found ${lineCount} priced lines and the model returned ${aiCount} — check the list below against your menu before importing.`
          : '';

      return { ok: true, draft: ai.draft, source: 'ai', note: `Read with ${ai.model}.${coverage}` };
    }

    note = `${ai.reason} Read with the rule parser instead.`;
  }

  const draft = parseMenuText(raw);
  if (draftItemCount(draft) === 0) {
    return {
      ok: false,
      error:
        draft.issues[0]?.reason ??
        'No dish with a price was found. Put one dish per line, with its price at the end — for example "Paneer Tikka 320".',
    };
  }

  return { ok: true, draft, source: 'rules', note };
}

export type ImportResult = { ok: true; menuId: string; items: number } | { ok: false; error: string };

/**
 * Write the draft as a new draft menu.
 *
 * Cleanup on failure is deliberate: categories and dishes inserted under a
 * menu that then failed to save would be orphaned rows the owner can neither
 * see nor delete.
 */
export async function createImportedMenuAction(payload: unknown): Promise<ImportResult> {
  const draft = sanitiseDraft(payload);
  if (draft.categories.length === 0) {
    return { ok: false, error: 'There is nothing to import. Go back and read the menu again.' };
  }

  const staff = await getStaffContextDetailed();
  if (!staff.ok) {
    if (staff.reason === 'unconfigured') return { ok: false, error: 'The database is not connected.' };
    return { ok: false, error: 'You need to be signed in to import a menu.' };
  }

  const { supabase, restaurantId } = staff.context;

  const { data: existing, error: listError } = await supabase
    .from('menus')
    .select('id, name, sort_order')
    .eq('restaurant_id', restaurantId);

  if (listError) return { ok: false, error: `Could not read your menus: ${listError.message}` };

  // A name that does not collide with an existing menu, so an import twice in
  // a row does not fail on a duplicate.
  const used = new Set((existing ?? []).map((row) => String(row.name ?? '').toLowerCase()));
  let name = 'Imported menu';
  for (let i = 2; used.has(name.toLowerCase()) && i < 50; i += 1) name = `Imported menu ${i}`;

  const nextOrder = (existing ?? []).reduce((max, row) => Math.max(max, Number(row.sort_order ?? 0)), 0) + 1;

  const { data: menu, error: menuError } = await supabase
    .from('menus')
    .insert({ restaurant_id: restaurantId, name, is_published: false, sort_order: nextOrder })
    .select('id')
    .maybeSingle();

  if (menuError || !menu) {
    return { ok: false, error: describeWriteError(menuError?.message, 'create the menu') };
  }

  const menuId = String(menu.id);

  const createdCategoryIds: string[] = [];
  let itemCount = 0;

  try {
    for (let index = 0; index < draft.categories.length; index += 1) {
      const category = draft.categories[index];

      const { data: createdCategory, error: categoryError } = await supabase
        .from('categories')
        .insert({ restaurant_id: restaurantId, menu_id: menuId, name: category.name, sort_order: index })
        .select('id')
        .maybeSingle();

      if (categoryError || !createdCategory) {
        throw new Error(describeWriteError(categoryError?.message, `add the section "${category.name}"`));
      }

      const categoryId = String(createdCategory.id);
      createdCategoryIds.push(categoryId);

      const { error: itemsError } = await supabase.from('items').insert(
        category.items.map((item, order) => ({
          restaurant_id: restaurantId,
          category_id: categoryId,
          name: item.name,
          description: item.description,
          price_paise: item.pricePaise,
          is_veg: item.isVeg,
          is_available: true,
          sort_order: order,
        })),
      );

      if (itemsError) throw new Error(describeWriteError(itemsError.message, `add the dishes in "${category.name}"`));
      itemCount += category.items.length;
    }
  } catch (error) {
    // Undo what this import created. Deleted in dependency order: dishes need
    // their category, categories need their menu.
    const message = error instanceof Error ? error.message : 'The import failed.';

    if (createdCategoryIds.length > 0) {
      await supabase.from('items').delete().in('category_id', createdCategoryIds);
      await supabase.from('categories').delete().in('id', createdCategoryIds);
    }
    await supabase.from('menus').delete().eq('id', menuId);

    console.error('[autodine] menu import rolled back:', message);
    return { ok: false, error: `${message} Nothing was imported.` };
  }

  // Open the new menu in the editor, exactly as creating one by hand does.
  (await cookies()).set(EDITOR_MENU_COOKIE, menuId, {
    path: MENUS_PATH,
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 180,
  });

  revalidatePath(MENUS_PATH);
  return { ok: true, menuId, items: itemCount };
}

/** Turn Postgres's answer into something an owner can act on. */
function describeWriteError(message: string | undefined, action: string): string {
  const detail = message ?? 'unknown error';

  if (/row-level security|permission denied/i.test(detail)) {
    return 'Only an owner or manager can change the menu, and the trial must still be running.';
  }
  if (/duplicate key/i.test(detail)) {
    return `Could not ${action}: something with that name already exists.`;
  }
  return `Could not ${action}: ${detail}`;
}
