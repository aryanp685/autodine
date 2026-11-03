/**
 * Server-side access to the Brand Studio tables.
 *
 * The shape of every function here is the same, on purpose:
 *
 *   { ok: true, ... } | { ok: false, error }
 *
 * and `error` is a sentence an owner can act on, never a stack trace. When a
 * deployment has not had the brand_studio migration applied yet, PostgREST
 * answers with a relation error; that becomes "This setting needs a database
 * update that has not been applied to this deployment yet." — the same
 * graceful degradation app/(staff)/dashboard/settings/actions.ts already
 * ships for guest_verification_mode. A screen must not 500 because a
 * migration is pending.
 *
 * Restaurant identity comes from the staff context (the membership row),
 * never from a parameter. Callers may pass ids only for things INSIDE their
 * own restaurant, and even those are re-checked against the context here.
 */

import { getStaffContextDetailed, type StaffContext } from '@/lib/db/staff';
import { sanitiseBrandDraft, draftToRow, rowToDraft, type BrandDraft } from './draft';

export type BrandAssetKind = 'logo' | 'banner' | 'reference' | 'menu-photo' | 'crop';

export type BrandAssetRecord = {
  id: string;
  kind: BrandAssetKind;
  bucket: string;
  path: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  source: 'upload' | 'extract';
  created_at: string;
};

export type BrandProfileRecord = {
  id: string;
  importId: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
  name: string | null;
  logoAssetId: string | null;
  bannerAssetId: string | null;
  menuId: string | null;
  draft: BrandDraft | null;
  updatedAt: string;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const MIGRATION_HINT =
  'This feature needs a database update that has not been applied to this deployment yet. Nothing was changed.';

/** Turn a PostgREST/Postgres failure into a sentence, or the migration hint. */
function describe(error: { message?: string; code?: string } | null | undefined, doing: string): string {
  const message = error?.message ?? '';
  const code = error?.code ?? '';
  if (code === '42P01' || /relation .* does not exist|column .* does not exist|schema cache/i.test(message)) {
    return MIGRATION_HINT;
  }
  if (/row-level security|permission denied/i.test(message)) {
    return 'Only an owner or manager can change the brand, and you can only touch your own restaurant.';
  }
  if (/duplicate key/i.test(message)) {
    return `Could not ${doing}: a draft for this import already exists.`;
  }
  return `Could not ${doing}: ${message || 'unknown error'}`;
}

async function context(): Promise<StaffContext | null> {
  const staff = await getStaffContextDetailed();
  return staff.ok ? staff.context : null;
}

function canWriteRole(role: string): boolean {
  return role === 'owner' || role === 'manager';
}

/* ---------------------------------------------------------------- assets */

/**
 * Record one stored asset. The bytes are already in Storage at `path`; this
 * writes the ownership/metadata row. A failure here is reported — an asset
 * without a record is an orphan the cleanup can find, not a silent success.
 */
export async function recordBrandAsset(input: {
  kind: BrandAssetKind;
  bucket: 'restaurant-assets' | 'restaurant-brand-source';
  path: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksum: string;
  source: 'upload' | 'extract';
}): Promise<Result<BrandAssetRecord>> {
  const ctx = await context();
  if (!ctx || !canWriteRole(ctx.role)) {
    return { ok: false, error: 'You need to be an owner or manager to add brand assets.' };
  }

  const { data, error } = await ctx.supabase
    .from('restaurant_brand_assets')
    .insert({
      restaurant_id: ctx.restaurantId,
      kind: input.kind,
      bucket: input.bucket,
      path: input.path,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      width: input.width,
      height: input.height,
      checksum: input.checksum,
      source: input.source,
    })
    .select('*')
    .maybeSingle();

  if (error || !data) return { ok: false, error: describe(error, 'record the asset') };
  return { ok: true, value: data as BrandAssetRecord };
}

/** Resolve an asset the caller owns, or fail. Never trust a bare id. */
export async function getOwnAsset(assetId: string): Promise<Result<BrandAssetRecord>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: 'You need to be signed in.' };
  const { data, error } = await ctx.supabase
    .from('restaurant_brand_assets')
    .select('*')
    .eq('id', assetId)
    .eq('restaurant_id', ctx.restaurantId)
    .maybeSingle();
  if (error) return { ok: false, error: describe(error, 'read the asset') };
  if (!data) return { ok: false, error: 'That asset is not on your account.' };
  return { ok: true, value: data as BrandAssetRecord };
}

/* --------------------------------------------------------------- profiles */

function toProfile(row: Record<string, unknown>): BrandProfileRecord {
  return {
    id: String(row.id),
    importId: String(row.import_id),
    status: row.status as BrandProfileRecord['status'],
    version: Number(row.version ?? 1),
    name: (row.name as string | null) ?? null,
    logoAssetId: (row.logo_asset_id as string | null) ?? null,
    bannerAssetId: (row.banner_asset_id as string | null) ?? null,
    menuId: (row.menu_id as string | null) ?? null,
    draft: rowToDraft({
      import_id: String(row.import_id),
      name: (row.name as string | null) ?? null,
      theme: row.theme,
      source: row.source,
      logo_asset_id: (row.logo_asset_id as string | null) ?? null,
      banner_asset_id: (row.banner_asset_id as string | null) ?? null,
    }),
    updatedAt: String(row.updated_at ?? ''),
  };
}

/**
 * Create (or return) the brand draft for one import.
 *
 * Idempotent by construction: the (restaurant_id, import_id) partial unique
 * index accepts one draft per import, so a repeated Create — a double-tap, a
 * retry after a network drop — finds the existing row and returns it instead
 * of making a second draft. "Prevent duplicate drafts on repeated Create
 * requests" is enforced by the database, not by hoping.
 */
export async function upsertBrandDraft(input: {
  draft: BrandDraft;
  menuId: string | null;
}): Promise<Result<BrandProfileRecord>> {
  const ctx = await context();
  if (!ctx || !canWriteRole(ctx.role)) {
    return { ok: false, error: 'You need to be an owner or manager to save a brand draft.' };
  }
  const draft = sanitiseBrandDraft(input.draft);
  if (!draft) return { ok: false, error: 'That brand draft is not valid. Read the brand again.' };

  const { data: existing, error: readError } = await ctx.supabase
    .from('restaurant_brand_profiles')
    .select('*')
    .eq('restaurant_id', ctx.restaurantId)
    .eq('import_id', draft.importId)
    .eq('status', 'draft')
    .maybeSingle();
  if (readError) return { ok: false, error: describe(readError, 'read the brand draft') };

  const row = draftToRow(draft);
  const payload = {
    restaurant_id: ctx.restaurantId,
    import_id: draft.importId,
    name: draft.name,
    logo_asset_id: draft.logoAssetId,
    banner_asset_id: draft.bannerAssetId,
    theme: row.theme as unknown as Record<string, unknown>,
    source: row.source,
    menu_id: input.menuId,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await ctx.supabase
      .from('restaurant_brand_profiles')
      .update(payload)
      .eq('id', existing.id)
      .eq('restaurant_id', ctx.restaurantId)
      .select('*')
      .maybeSingle();
    if (error || !data) return { ok: false, error: describe(error, 'update the brand draft') };
    return { ok: true, value: toProfile(data as Record<string, unknown>) };
  }

  const { data, error } = await ctx.supabase
    .from('restaurant_brand_profiles')
    .insert(payload)
    .select('*')
    .maybeSingle();
  if (error || !data) return { ok: false, error: describe(error, 'create the brand draft') };
  return { ok: true, value: toProfile(data as Record<string, unknown>) };
}

/** The brand draft linked to an imported menu, if one exists. */
export async function getDraftForMenu(menuId: string): Promise<Result<BrandProfileRecord | null>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: 'You need to be signed in.' };
  const { data, error } = await ctx.supabase
    .from('restaurant_brand_profiles')
    .select('*')
    .eq('restaurant_id', ctx.restaurantId)
    .eq('menu_id', menuId)
    .eq('status', 'draft')
    .maybeSingle();
  if (error) return { ok: false, error: describe(error, 'read the brand draft') };
  return { ok: true, value: data ? toProfile(data as Record<string, unknown>) : null };
}

/** The draft for one import id (found again after a retry or reload). */
export async function getDraftForImport(importId: string): Promise<Result<BrandProfileRecord | null>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: 'You need to be signed in.' };
  const { data, error } = await ctx.supabase
    .from('restaurant_brand_profiles')
    .select('*')
    .eq('restaurant_id', ctx.restaurantId)
    .eq('import_id', importId)
    .maybeSingle();
  if (error) return { ok: false, error: describe(error, 'read the brand draft') };
  return { ok: true, value: data ? toProfile(data as Record<string, unknown>) : null };
}

/* ------------------------------------------------------ publish / rollback */

export async function publishPair(
  menuId: string,
  brandProfileId: string,
): Promise<Result<{ already: boolean }>> {
  const ctx = await context();
  if (!ctx || !canWriteRole(ctx.role)) {
    return { ok: false, error: 'You need to be an owner or manager to publish.' };
  }
  const { data, error } = await ctx.supabase.rpc('publish_menu_brand_pair', {
    p_menu_id: menuId,
    p_brand_profile_id: brandProfileId,
  });
  if (error) return { ok: false, error: describe(error, 'publish') };
  const result = (data ?? {}) as { ok?: boolean; already?: boolean; reason?: string };
  if (!result.ok) return { ok: false, error: result.reason ?? 'The publish did not complete.' };
  return { ok: true, value: { already: result.already === true } };
}

export async function rollbackLastPublish(): Promise<Result<{ already: boolean }>> {
  const ctx = await context();
  if (!ctx || !canWriteRole(ctx.role)) {
    return { ok: false, error: 'You need to be an owner or manager to roll back.' };
  }
  const { data, error } = await ctx.supabase.rpc('rollback_last_publish', {
    p_restaurant_id: ctx.restaurantId,
  });
  if (error) return { ok: false, error: describe(error, 'roll back') };
  const result = (data ?? {}) as { ok?: boolean; already?: boolean; reason?: string };
  if (!result.ok) return { ok: false, error: result.reason ?? 'The rollback did not complete.' };
  return { ok: true, value: { already: result.already === true } };
}

/** Does this deployment have the brand tables yet? The screens ask first. */
export async function brandStudioAvailable(): Promise<boolean> {
  const ctx = await context();
  if (!ctx) return false;
  const { error } = await ctx.supabase
    .from('restaurant_brand_profiles')
    .select('id')
    .limit(1);
  return !error;
}
