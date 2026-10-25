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
  extractMenuFromImage,
  validateMenuCapture,
  visionConfigured,
  type VisionDraft,
} from '@/lib/ai/menu-vision';
import { ASSET_BUCKET, dishAssetPath, publicAssetUrl } from '@/lib/storage/assets';
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

/**
 * Read a photographed (or scanned) menu. Writes nothing.
 *
 * Separate from previewMenuImportAction because the input is different: this
 * one takes bytes, sends them to Gemini, and returns a draft whose uncertain
 * fields are EMPTY rather than guessed. The response also says which dishes
 * have their own printed photo, with a box, so the review step can offer to
 * crop them out of the same upload.
 *
 * Every failure is a sentence the owner can act on: no key, wrong file, too
 * big, busy, timed out, or simply not a menu. None of them is a stack trace.
 */
export async function extractMenuFromPhotoAction(formData: FormData): Promise<PhotoPreview> {
  if (!visionConfigured()) {
    return {
      ok: false,
      code: 'not-configured',
      error: 'Reading photos is not switched on for this deployment. Add dishes by hand, or paste the text.',
    };
  }

  const staff = await getStaffContextDetailed();
  if (!staff.ok) {
    return {
      ok: false,
      code: 'not-signed-in',
      error:
        staff.reason === 'unconfigured'
          ? 'The database is not connected, so there is nowhere to save an import.'
          : 'You need to be signed in to import a menu.',
    };
  }
  if (staff.context.role !== 'owner' && staff.context.role !== 'manager') {
    return { ok: false, code: 'not-allowed', error: 'Only an owner or manager can import a menu.' };
  }

  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, code: 'bad-file', error: 'Choose a photo of your menu first.' };
  }

  const checked = validateMenuCapture(file);
  if (!checked.ok) return { ok: false, code: checked.code, error: checked.reason };

  const result = await extractMenuFromImage(await file.arrayBuffer(), checked.mimeType);
  if (!result.ok) return { ok: false, code: result.code, error: result.reason };

  return { ok: true, draft: result.draft };
}

export type PhotoPreview =
  | { ok: true; draft: VisionDraft }
  | { ok: false; error: string; code: string };

/** One cropped dish photo, as the browser produced it. */
export type CropUpload = {
  /** Which category / dish in the draft this crop belongs to. */
  categoryIndex: number;
  itemIndex: number;
  /** A data URL: image/jpeg base64. Produced by canvas, never by the model. */
  dataUrl: string;
};

/**
 * Attach crops the owner accepted, after the menu exists.
 *
 * Cropping happens in the browser (canvas, no server image library, no native
 * dependency) and lands here as bytes. Each crop is validated, uploaded, and
 * written to the item's image_url.
 *
 * Failure is never fatal: a menu with text and no photos is a perfectly good
 * import, so a bad crop is counted and reported rather than rolling back the
 * whole import.
 */
export async function attachImportPhotosAction(
  menuId: string,
  crops: CropUpload[],
): Promise<{ ok: true; attached: number; skipped: number } | { ok: false; error: string }> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return { ok: false, error: 'You need to be signed in to add photos.' };
  if (staff.context.role !== 'owner' && staff.context.role !== 'manager') {
    return { ok: false, error: 'Only an owner or manager can change the menu.' };
  }

  const { supabase, restaurantId } = staff.context;

  // The menu must belong to this restaurant: a forged id must not let an
  // import write photos onto somebody else's dishes.
  const { data: menu } = await supabase
    .from('menus')
    .select('id')
    .eq('id', menuId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (!menu) return { ok: false, error: 'That menu is not on your account.' };

  const { data: items } = await supabase
    .from('items')
    .select('id, category_id, name, sort_order')
    .eq('restaurant_id', restaurantId);

  if (!items) return { ok: false, error: 'Could not read the imported dishes.' };

  const byCategory = new Map<string, { id: string; name: string; sortOrder: number }[]>();
  for (const row of items) {
    const key = String(row.category_id ?? '');
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push({
      id: String(row.id),
      name: String(row.name ?? ''),
      sortOrder: Number(row.sort_order ?? 0),
    });
  }

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, sort_order')
    .eq('restaurant_id', restaurantId)
    .eq('menu_id', menuId)
    .order('sort_order', { ascending: true });

  if (!categories) return { ok: false, error: 'Could not read the imported sections.' };

  let attached = 0;
  let skipped = 0;

  for (const crop of crops.slice(0, 60)) {
    const category = categories[crop.categoryIndex];
    if (!category) {
      skipped += 1;
      continue;
    }

    const bucketItems = (byCategory.get(String(category.id)) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const item = bucketItems[crop.itemIndex];
    if (!item) {
      skipped += 1;
      continue;
    }

    const decoded = decodeDataUrl(crop.dataUrl);
    // 600 KB per crop, 2 MB is impossible after client-side scaling, and this
    // is the guard for a hand-crafted request.
    if (!decoded || decoded.bytes.byteLength === 0 || decoded.bytes.byteLength > 600_000) {
      skipped += 1;
      continue;
    }

    const path = dishAssetPath(restaurantId, item.id, 'jpg');
    const { error: uploadError } = await supabase.storage
      .from(ASSET_BUCKET)
      .upload(path, decoded.bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });

    if (uploadError) {
      console.error('[autodine] crop upload failed', uploadError);
      skipped += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from('items')
      .update({ image_url: publicAssetUrl(path) })
      .eq('id', item.id)
      .eq('restaurant_id', restaurantId);

    if (updateError) {
      console.error('[autodine] crop not saved to item', updateError);
      skipped += 1;
      continue;
    }

    attached += 1;
  }

  return { ok: true, attached, skipped };
}

/** `data:image/jpeg;base64,...` -> bytes. Returns null for anything else. */
function decodeDataUrl(dataUrl: string): { bytes: Buffer } | null {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const bytes = Buffer.from(match[2], 'base64');
    return bytes.byteLength > 0 ? { bytes } : null;
  } catch {
    return null;
  }
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
