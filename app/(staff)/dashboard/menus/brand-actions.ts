/**
 * Brand Studio server actions.
 *
 * THE RULES THESE FOLLOW
 *
 *   - Extraction writes NOTHING (not to the menu tables, not to brand
 *     settings). It reads bytes and returns a draft.
 *   - Uploads persist bytes + an ownership row, so a retry after a network
 *     drop does not lose the owner's file — but they never touch live
 *     settings. "Do not save approved brand settings during extraction or
 *     review."
 *   - Create Draft writes exactly two things — the menu draft (the existing
 *     createImportedMenuAction, unchanged in behaviour) and one brand draft
 *     row linked by import_id — and if the second half fails the first half
 *     is undone. Failed creation fully rolls back.
 *   - Publish goes through publish_menu_brand_pair: one transaction, menu and
 *     brand together, or the previous live pair stands.
 *
 * Restaurant identity always comes from the staff context. Every id this file
 * accepts is re-scoped to the caller's own restaurant before use.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { getStaffContextDetailed, type StaffContext } from '@/lib/db/staff';
import {
  createImportedMenuAction,
  type ImportResult,
} from '@/app/(staff)/dashboard/menus/import-actions';
import {
  extractBrandFromImage,
  validateBrandCapture,
  type BrandExtraction,
} from '@/lib/ai/brand-vision';
import {
  publishPair,
  recordBrandAsset,
  rollbackLastPublish,
  upsertBrandDraft,
  type BrandAssetRecord,
} from '@/lib/branding/brand-data';
import { sanitiseBrandDraft, type BrandDraft } from '@/lib/branding/draft';
import { prepareAsset, assetObjectPath } from '@/lib/branding/uploads';
import { publicAssetUrl } from '@/lib/storage/assets';

/* --------------------------------------------------------- rate limiting */

/**
 * Owner-triggered vision calls are rare by design, so a tiny in-memory
 * limiter is enough to stop a double-tap storm from spending the budget.
 * Best-effort across serverless instances — the real ceilings are the
 * provider's and the 8 MB / 3-page caps — and deliberately not a hard
 * security control.
 */
const lastExtraction = new Map<string, number>();
const EXTRACTION_GAP_MS = 10_000;

function extractionAllowed(restaurantId: string): boolean {
  const now = Date.now();
  const last = lastExtraction.get(restaurantId) ?? 0;
  if (now - last < EXTRACTION_GAP_MS) return false;
  lastExtraction.set(restaurantId, now);
  return true;
}

/* -------------------------------------------------------------- context */

async function manageContext() {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return null;
  if (staff.context.role !== 'owner' && staff.context.role !== 'manager') return null;
  return staff.context;
}

/* -------------------------------------------------- brand extraction */

export type BrandPreview =
  | { ok: true; extraction: BrandExtraction }
  | { ok: false; error: string; code: string };

/**
 * Read the visual identity from one photo/PDF. Writes nothing.
 * Same file rules as the menu reader (8 MB, JPG/PNG/WebP/PDF).
 */
export async function extractBrandFromPhotoAction(formData: FormData): Promise<BrandPreview> {
  const ctx = await manageContext();
  if (!ctx) {
    return {
      ok: false,
      code: 'not-allowed',
      error: 'You need to be an owner or manager to read brand style.',
    };
  }
  if (!extractionAllowed(ctx.restaurantId)) {
    return {
      ok: false,
      code: 'rate-limited',
      error: 'One read at a time — wait a few seconds and try again.',
    };
  }

  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, code: 'bad-file', error: 'Choose a menu photo or reference image first.' };
  }

  const checked = validateBrandCapture(file);
  if (!checked.ok) return { ok: false, code: checked.code, error: checked.reason };

  const result = await extractBrandFromImage(await file.arrayBuffer(), checked.mimeType);
  if (!result.ok) return { ok: false, code: result.code, error: result.reason };
  return { ok: true, extraction: result.extraction };
}

/* --------------------------------------------------------------- uploads */

export type UploadResult =
  | { ok: true; asset: { id: string; kind: string; url: string; width: number | null; height: number | null } }
  | { ok: false; error: string };

/**
 * Store one brand asset (logo, banner or reference) with its metadata.
 * Live settings are NOT touched — the review decides later what goes live.
 */
export async function uploadBrandAssetAction(formData: FormData): Promise<UploadResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: 'You need to be an owner or manager to upload brand assets.' };

  const kindRaw = String(formData.get('kind') ?? '');
  const kind = (
    ['logo', 'banner', 'reference', 'menu-photo', 'crop'] as const
  ).includes(kindRaw as 'logo') ? (kindRaw as 'logo' | 'banner' | 'reference' | 'menu-photo' | 'crop') : null;
  if (!kind) return { ok: false, error: 'Unknown asset type.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a file first.' };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const prepared = prepareAsset({ size: file.size, type: file.type, name: file.name }, bytes, kind);
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const path = assetObjectPath(ctx.restaurantId, kind, prepared.asset.extension);
  const { error: uploadError } = await ctx.supabase.storage
    .from(prepared.asset.bucket)
    .upload(path, prepared.asset.bytes, {
      contentType: prepared.asset.mime,
      upsert: false,
      cacheControl: '31536000',
    });
  if (uploadError) {
    console.error('[autodine] brand asset upload failed', uploadError);
    return { ok: false, error: 'The file could not be stored. Try again — nothing was changed.' };
  }

  const record = await recordBrandAsset({
    kind,
    bucket: prepared.asset.bucket,
    path,
    mimeType: prepared.asset.mime,
    byteSize: prepared.asset.byteSize,
    width: prepared.asset.width,
    height: prepared.asset.height,
    checksum: prepared.asset.checksum,
    source: 'upload',
  });
  if (!record.ok) {
    // The bytes are in Storage but not owned in the database: remove them
    // rather than leave an orphan we cannot name later.
    await ctx.supabase.storage.from(prepared.asset.bucket).remove([path]);
    return record;
  }

  // Public assets resolve by URL; source assets are private and get a signed
  // URL so the review screen can show them without widening the bucket.
  const url =
    prepared.asset.bucket === 'restaurant-assets'
      ? publicAssetUrl(path) ?? ''
      : await signedUrl(ctx.supabase, prepared.asset.bucket, path);

  return {
    ok: true,
    asset: {
      id: record.value.id,
      kind,
      url,
      width: prepared.asset.width,
      height: prepared.asset.height,
    },
  };
}

async function signedUrl(
  supabase: StaffContext['supabase'],
  bucket: string,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return error || !data?.signedUrl ? '' : data.signedUrl;
}

/* ------------------------------------------------------- create the pair */

export type PairResult = ImportResult & { brandProfileId?: string };

/**
 * Create Draft: the menu draft AND its brand draft, linked by import_id.
 *
 * Idempotent on the menu half (a repeat Create with the same import_id finds
 * the existing draft instead of making "Imported menu 2") and on the brand
 * half (the (restaurant_id, import_id) unique index allows one draft).
 * If the brand half cannot be written, a menu created by THIS call is
 * removed again — a pre-existing menu from an earlier call is left alone.
 */
export async function createImportPairAction(payload: {
  menu: unknown;
  brand: unknown;
}): Promise<PairResult> {
  const draft = sanitiseBrandDraft(payload.brand);
  if (!draft) {
    return { ok: false, error: 'That brand draft is not valid. Read the brand again before creating.' };
  }

  const menuResult = await createImportedMenuAction(payload.menu);
  if (!menuResult.ok) return menuResult;

  const brandResult = await upsertBrandDraft({ draft, menuId: menuResult.menuId });
  if (!brandResult.ok) {
    // Full rollback of THIS call's menu creation. A menu that already
    // existed (idempotent hit) is not ours to delete.
    if (!menuResult.existing) await discardMenuDraft(menuResult.menuId);
    return { ok: false, error: brandResult.error };
  }

  return {
    ok: true,
    menuId: menuResult.menuId,
    items: menuResult.items,
    existing: menuResult.existing,
    brandProfileId: brandResult.value.id,
  };
}

/** Delete a freshly created import draft in dependency order. */
async function discardMenuDraft(menuId: string): Promise<void> {
  const ctx = await manageContext();
  if (!ctx) return;
  const { data: categories } = await ctx.supabase
    .from('categories')
    .select('id')
    .eq('menu_id', menuId)
    .eq('restaurant_id', ctx.restaurantId);
  const categoryIds = (categories ?? []).map((c) => String(c.id));
  if (categoryIds.length > 0) {
    await ctx.supabase.from('items').delete().in('category_id', categoryIds);
    await ctx.supabase.from('categories').delete().in('id', categoryIds);
  }
  await ctx.supabase.from('menus').delete().eq('id', menuId).eq('restaurant_id', ctx.restaurantId);
  console.error('[autodine] brand pair rolled back its menu draft:', menuId);
}

/* --------------------------------------------------- publish and rollback */

export type PublishResult = { ok: true; already: boolean } | { ok: false; error: string };

/**
 * Publish the menu + brand pair. Refuses while the name is unconfirmed or
 * the draft still carries conflicts the owner has not resolved — "no
 * unresolved critical validation errors" before publish.
 */
export async function publishImportAction(
  menuId: string,
  brandProfileId: string,
  checks: { nameConfirmed: boolean; unresolvedConflicts: number },
): Promise<PublishResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: 'You need to be an owner or manager to publish.' };

  if (checks.unresolvedConflicts > 0) {
    return {
      ok: false,
      error: 'Some brand questions are still open. Answer them in the brand review, then publish.',
    };
  }
  if (!checks.nameConfirmed) {
    return {
      ok: false,
      error: 'Confirm the restaurant name in the brand review before publishing.',
    };
  }

  const result = await publishPair(menuId, brandProfileId);
  if (!result.ok) return result;

  revalidatePath('/menu');
  revalidatePath('/dashboard/menus');
  revalidatePath('/dashboard/branding');
  return { ok: true, already: result.value.already };
}

export async function rollbackBrandPublishAction(): Promise<PublishResult> {
  const ctx = await manageContext();
  if (!ctx) return { ok: false, error: 'You need to be an owner or manager to roll back.' };

  const result = await rollbackLastPublish();
  if (!result.ok) return result;

  revalidatePath('/menu');
  revalidatePath('/dashboard/menus');
  revalidatePath('/dashboard/branding');
  return { ok: true, already: result.value.already };
}

/** Redirect helpers for form-style callers. */
export async function rollbackPublishFormAction(): Promise<void> {
  const result = await rollbackBrandPublishAction();
  redirect(
    `/dashboard/branding?${result.ok ? 'notice' : 'error'}=${encodeURIComponent(
      result.ok ? 'Previous menu and brand are live again.' : result.error,
    )}`,
  );
}

/** A stable import id for the client to hold across retries. */
export async function newImportIdAction(): Promise<string> {
  return randomUUID();
}
