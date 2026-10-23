/**
 * The one bucket, and the rules for putting something in it.
 *
 * WHY A PATH FOR BRANDING AND A URL FOR DISHES
 *
 * `items.image_url` is a URL column with three existing readers and demo rows
 * holding `/img/dishes/...`. Changing its meaning would break every one of
 * them, so a dish photo stores the public URL.
 *
 * `restaurants.logo_path` / `banner_path` are new and store the object PATH. A
 * URL embeds the Supabase project ref and would have to be rewritten on a
 * project move; the path is the durable fact and `publicAssetUrl` turns it
 * into a URL at render time. Each column means what its name says.
 *
 * WHY VALIDATION LIVES HERE AND NOT IN THE ACTION
 *
 * The bucket enforces mime type and a 4 MB ceiling, but a browser that lies
 * about `file.type` would still reach Storage and fail with a raw error the
 * owner cannot act on. This module turns `{ size, type }` into either an
 * error the owner can read ("That photo is 6.2 MB. The limit is 4 MB.") or an
 * extension we are willing to write. The bucket remains the second fence.
 */

import { randomUUID } from 'node:crypto';
import { SUPABASE_URL } from '@/lib/supabase/env';

export const ASSET_BUCKET = 'restaurant-assets';

/** The only image types the bucket accepts. Mirrored in the migration. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type AssetKind = 'logo' | 'banner' | 'dish';

/**
 * Ceilings per kind. The bucket allows 4 MB for everything; a logo is held to
 * half of that because a 4 MB logo is a mistake, not a decision -- it is drawn
 * at 48px on a phone.
 */
export const MAX_BYTES: Record<AssetKind, number> = {
  logo: 2 * 1024 * 1024,
  banner: 4 * 1024 * 1024,
  dish: 4 * 1024 * 1024,
};

export type Validation =
  | { ok: true; extension: string; contentType: string }
  | { ok: false; message: string };

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check a file before it is uploaded.
 *
 * `type` is the browser's claim, not proof, which is exactly why the bucket
 * also carries `allowed_mime_types`: this check exists to give a good message,
 * the bucket exists to be the actual guarantee.
 */
export function validateImage(file: {
  size: number;
  type: string;
  name?: string;
}): Validation {
  const type = (file.type || '').toLowerCase().trim();

  // Some Android browsers send an empty type for a camera capture. Falling
  // back to the extension keeps a real photo from being refused for a
  // metadata quirk, while still refusing an obvious non-image.
  const fromName = /\.([a-z0-9]+)$/i.exec(file.name ?? '')?.[1]?.toLowerCase() ?? '';
  const guessed =
    type ||
    (fromName === 'jpg' || fromName === 'jpeg'
      ? 'image/jpeg'
      : fromName === 'png'
        ? 'image/png'
        : fromName === 'webp'
          ? 'image/webp'
          : '');

  if (!guessed || !ALLOWED_IMAGE_TYPES.includes(guessed as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return { ok: false, message: 'That file is not a JPG, PNG or WebP image.' };
  }

  if (file.size <= 0) {
    return { ok: false, message: 'That file is empty. Try another photo.' };
  }

  return { ok: true, extension: EXTENSION[guessed], contentType: guessed };
}

/** Size check per kind, kept separate so the message can name the limit. */
export function checkSize(kind: AssetKind, size: number, extension: string): Validation {
  const limit = MAX_BYTES[kind];
  if (size > limit) {
    return {
      ok: false,
      message: `That photo is ${megabytes(size)}. The limit is ${megabytes(limit)}.`,
    };
  }
  return { ok: true, extension, contentType: '' };
}

/**
 * Where an object lives.
 *
 * The first path segment MUST be the restaurant id: the Storage policies in
 * migration 20261025001000 read exactly that segment to decide whether the
 * caller may write. A path built any other way is refused by the database,
 * which is the behaviour we want -- but it would surface as an opaque RLS
 * error, so this is the only place paths are made.
 *
 * `unique` stamps the filename with a random suffix. Overwriting
 * `<id>/logo.png` in place looks tidier, but browsers and the Next image
 * optimiser cache by URL, so a replaced logo would keep showing the old one.
 * A new name per upload makes the change visible immediately; the old object
 * is deleted by the action that replaced it.
 */
export function assetPath(
  restaurantId: string,
  kind: AssetKind,
  extension: string,
  { unique = true }: { unique?: boolean } = {},
): string {
  const suffix = unique ? `-${randomUUID().slice(0, 8)}` : '';
  if (kind === 'dish') {
    // Dish photos are keyed by item so a deleted dish's file is easy to find.
    return `${restaurantId}/dishes/${suffix.replace(/^-/, '')}.${extension}`;
  }
  return `${restaurantId}/${kind}${suffix}.${extension}`;
}

/** A dish photo path that names its item, for traceability in the bucket. */
export function dishAssetPath(restaurantId: string, itemId: string, extension: string): string {
  return `${restaurantId}/dishes/${itemId}-${randomUUID().slice(0, 8)}.${extension}`;
}

/**
 * Turn a stored path into a public URL.
 *
 * The bucket is public-read (see the migration), so no signing is needed and
 * a diner's phone can load this without a session. Returns null when Supabase
 * is not configured or the path is empty, and every caller treats null as "no
 * asset": the guest menu draws its initials tile rather than a broken image.
 */
export function publicAssetUrl(path: string | null | undefined): string | null {
  const clean = path?.trim();
  if (!clean) return null;
  // A stored value that is already absolute (a demo row, or an object written
  // before this helper existed) is passed through untouched.
  if (/^https?:\/\//i.test(clean) || clean.startsWith('/')) return clean;
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${ASSET_BUCKET}/${clean}`;
}

/**
 * Is this stored value one of ours? Used before deleting an object so a demo
 * row pointing at `/img/dishes/...` is never handed to the Storage API.
 */
export function isBucketPath(value: string | null | undefined): boolean {
  const clean = value?.trim();
  if (!clean) return false;
  return !/^https?:\/\//i.test(clean) && !clean.startsWith('/');
}

/**
 * The inverse of publicAssetUrl: which object is this URL pointing at?
 *
 * Needed before deleting a replaced photo. A dish row can hold `/img/dishes/
 * paneer.jpg` (a demo row) or a foreign URL, and neither is an object in this
 * bucket -- handing either to the Storage API would be a 400 at best.
 * Returns null for anything that is not ours.
 */
export function bucketPathFromUrl(url: string | null | undefined): string | null {
  const clean = url?.trim();
  if (!clean || !SUPABASE_URL) return null;
  const prefix = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${ASSET_BUCKET}/`;
  if (!clean.startsWith(prefix)) return null;
  const path = decodeURIComponent(clean.slice(prefix.length));
  return isBucketPath(path) ? path : null;
}
