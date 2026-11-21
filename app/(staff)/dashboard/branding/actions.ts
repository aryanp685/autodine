/**
 * Branding writes: logo and banner.
 *
 * THE ORDER OF OPERATIONS ON A REPLACE MATTERS
 *
 *   1. upload the new object          (if this fails, nothing has changed)
 *   2. point the row at it            (if this fails, the old row stands)
 *   3. delete the old object          (if this fails, we have one orphan and a
 *                                      working page -- logged, not fatal)
 *
 * Deleting first would mean a failed upload leaves a restaurant with no logo,
 * which is the one outcome that must never happen by accident.
 *
 * WHY THE PATHS ARE NOT TAKEN FROM THE FORM
 *
 * The old path to delete comes from the database row, read server-side. A form
 * that supplied it could ask this action to delete another tenant's object --
 * Storage would refuse (the policy reads the path prefix), but the request
 * should never be constructible in the first place.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getStaffContextDetailed } from '@/lib/db/staff';
import {
  ASSET_BUCKET,
  assetPath,
  checkSize,
  isBucketPath,
  validateImage,
  type AssetKind,
} from '@/lib/storage/assets';

const PATH = '/dashboard/branding';

function done(message: string): never {
  revalidatePath(PATH);
  // The guest menu and the item sheet read branding, so their cached copies
  // are stale the moment this returns.
  revalidatePath('/menu');
  redirect(`${PATH}?notice=${encodeURIComponent(message)}`);
}

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

async function context() {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return null;
  if (staff.context.role !== 'owner' && staff.context.role !== 'manager') return null;
  return staff.context;
}

/**
 * Shared upload path for logo and banner.
 *
 * A Server Action receives the file as a `File` in FormData. Next.js caps the
 * request body separately (see next.config's serverActions bodySizeLimit), so
 * this function still re-checks size: the config limit is about the whole
 * request, this is about the asset.
 */
async function uploadBrandAsset(kind: Extract<AssetKind, 'logo' | 'banner'>, formData: FormData) {
  const ctx = await context();
  if (!ctx) fail('You need to be an owner or manager to change branding.');

  const file = formData.get(kind);
  if (!(file instanceof File) || file.size === 0) {
    fail(`Choose a ${kind} image first.`);
  }

  const checked = validateImage(file);
  if (!checked.ok) fail(checked.message);

  const sized = checkSize(kind, file.size, checked.extension);
  if (!sized.ok) fail(sized.message);

  const path = assetPath(ctx.restaurantId, kind, checked.extension);

  const { error: uploadError } = await ctx.supabase.storage
    .from(ASSET_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: checked.contentType,
      // The path is unique per upload, so an existing object here means
      // something is wrong; refusing to overwrite keeps that visible.
      upsert: false,
      cacheControl: '31536000',
    });

  if (uploadError) {
    console.error(`[branding] ${kind} upload failed`, uploadError);
    fail(
      /row-level security|permission/i.test(uploadError.message)
        ? 'The database refused that upload for this account. Nothing was changed.'
        : 'That upload did not go through. Nothing was changed — please try again.'
    );
  }

  return { ctx, path };
}

export async function uploadLogoAction(formData: FormData): Promise<void> {
  const { ctx, path } = await uploadBrandAsset('logo', formData);

  const { data: previous } = await ctx.supabase
    .from('restaurants')
    .select('logo_path')
    .eq('id', ctx.restaurantId)
    .maybeSingle();

  const { data: saved, error } = await ctx.supabase
    .from('restaurants')
    .update({ logo_path: path, updated_at: new Date().toISOString() })
    .eq('id', ctx.restaurantId)
    .select('id');

  if (error || !saved || saved.length === 0) {
    // Put nothing on the row, and do not leave the upload behind.
    await ctx.supabase.storage.from(ASSET_BUCKET).remove([path]);
    fail('Could not save the logo. Nothing was changed.');
  }

  const old = (previous as { logo_path?: string | null } | null)?.logo_path ?? null;
  if (isBucketPath(old)) {
    const { error: removeError } = await ctx.supabase.storage.from(ASSET_BUCKET).remove([old!]);
    if (removeError) console.error('[branding] old logo not deleted', removeError);
  }

  done('Logo updated. Diners see it the next time the menu loads.');
}

export async function uploadBannerAction(formData: FormData): Promise<void> {
  const { ctx, path } = await uploadBrandAsset('banner', formData);

  const { data: previous } = await ctx.supabase
    .from('restaurants')
    .select('banner_path')
    .eq('id', ctx.restaurantId)
    .maybeSingle();

  const { data: saved, error } = await ctx.supabase
    .from('restaurants')
    .update({ banner_path: path, updated_at: new Date().toISOString() })
    .eq('id', ctx.restaurantId)
    .select('id');

  if (error || !saved || saved.length === 0) {
    await ctx.supabase.storage.from(ASSET_BUCKET).remove([path]);
    fail('Could not save the banner. Nothing was changed.');
  }

  const old = (previous as { banner_path?: string | null } | null)?.banner_path ?? null;
  if (isBucketPath(old)) {
    const { error: removeError } = await ctx.supabase.storage.from(ASSET_BUCKET).remove([old!]);
    if (removeError) console.error('[branding] old banner not deleted', removeError);
  }

  done('Banner updated.');
}

/**
 * Remove a logo or banner.
 *
 * The row is cleared FIRST and the object second. If the delete fails, the
 * page is still correct -- nothing points at the file -- and the worst case is
 * a few kilobytes sitting in the bucket, which an operator can sweep. The
 * reverse order risks a row pointing at a file that no longer exists, which is
 * a broken image on a diner's phone.
 */
async function removeBrandAsset(kind: 'logo' | 'banner'): Promise<void> {
  const ctx = await context();
  if (!ctx) fail('You need to be an owner or manager to change branding.');

  const column = kind === 'logo' ? 'logo_path' : 'banner_path';

  const { data: previous } = await ctx.supabase
    .from('restaurants')
    .select(column)
    .eq('id', ctx.restaurantId)
    .maybeSingle();

  const old = (previous as Record<string, string | null> | null)?.[column] ?? null;

  // Written as two explicit branches rather than a computed key: the typed
  // client cannot narrow `{ [column]: null }` to a known column, and a cast
  // here would be hiding that from the compiler rather than telling it.
  const patch =
    kind === 'logo'
      ? { logo_path: null, updated_at: new Date().toISOString() }
      : { banner_path: null, updated_at: new Date().toISOString() };

  const { data: saved, error } = await ctx.supabase
    .from('restaurants')
    .update(patch)
    .eq('id', ctx.restaurantId)
    .select('id');

  if (error || !saved || saved.length === 0) fail(`Could not remove the ${kind}. Nothing was changed.`);

  if (isBucketPath(old)) {
    const { error: removeError } = await ctx.supabase.storage.from(ASSET_BUCKET).remove([old!]);
    if (removeError) console.error(`[branding] ${kind} object not deleted`, removeError);
  }

  done(
    kind === 'logo'
      ? 'Logo removed. Your menu shows your initials instead.'
      : 'Banner removed. Your menu uses the paper header.'
  );
}

export async function removeLogoAction(): Promise<void> {
  await removeBrandAsset('logo');
}

export async function removeBannerAction(): Promise<void> {
  await removeBrandAsset('banner');
}

/*
 * THERE IS NO saveAccentAction ANY MORE.
 *
 * It wrote `restaurants.accent`, and the guest flow painted itself with that
 * value -- so two restaurants were two products. The flow is now one design for
 * every customer (lib/branding/palette.ts, guestAccentStyle), which made this
 * action a Save button for a change nobody could see. Removed rather than left
 * dormant: a server action is a URL, and a URL that writes a column nothing
 * renders is a liability with no upside.
 *
 * The column stays. It holds each restaurant's old choice untouched.
 */
