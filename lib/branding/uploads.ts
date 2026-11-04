/**
 * Preparing an image for the brand studio: validate, measure, fingerprint.
 *
 * The bytes are looked at TWICE on purpose. `validateImage` (lib/storage/
 * assets.ts) checks what the browser CLAIMS; `sniffImageMime` (image-meta.ts)
 * checks what the bytes ARE; `imageDimensions` measures them; and the sha256
 * checksum is what lets two uploads of the same original be recognised as one
 * asset instead of stored twice ("do not store duplicate original images
 * without reason").
 *
 * Everything here is synchronous and pure over the bytes — the storage write
 * and the metadata row live in the server action, so this module is testable
 * without a database.
 */

import { createHash, randomUUID } from 'node:crypto';
import { imageDimensions, sniffImageMime } from './image-meta';
import type { BrandAssetKind } from './brand-data';

/** Which bucket each kind lives in: guest-rendered vs owner-only source. */
export const ASSET_BUCKET_FOR: Record<BrandAssetKind, 'restaurant-assets' | 'restaurant-brand-source'> = {
  logo: 'restaurant-assets',
  banner: 'restaurant-assets',
  crop: 'restaurant-assets',
  reference: 'restaurant-brand-source',
  'menu-photo': 'restaurant-brand-source',
};

/** The bucket ceiling is 8 MB for source files, 4 MB for guest assets. */
const MAX_BYTES: Record<BrandAssetKind, number> = {
  logo: 2 * 1024 * 1024,
  banner: 4 * 1024 * 1024,
  crop: 4 * 1024 * 1024,
  reference: 8 * 1024 * 1024,
  'menu-photo': 8 * 1024 * 1024,
};

export type PreparedAsset = {
  kind: BrandAssetKind;
  bucket: 'restaurant-assets' | 'restaurant-brand-source';
  mime: string;
  extension: string;
  bytes: Buffer;
  byteSize: number;
  width: number | null;
  height: number | null;
  /** sha256 hex — the identity of these bytes. */
  checksum: string;
};

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Validate and measure one uploaded file.
 * Returns an owner-readable error for every refusal — never a stack trace,
 * never a silent accept.
 */
export function prepareAsset(
  file: { size: number; type: string; name?: string },
  bytes: Buffer,
  kind: BrandAssetKind,
): { ok: true; asset: PreparedAsset } | { ok: false; error: string } {
  const ceiling = MAX_BYTES[kind];
  if (file.size <= 0 || bytes.byteLength === 0) {
    return { ok: false, error: 'That file is empty.' };
  }
  if (file.size > ceiling || bytes.byteLength > ceiling) {
    const mb = (Math.max(file.size, bytes.byteLength) / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `That file is ${mb} MB. The limit for this file is ${Math.round(ceiling / (1024 * 1024))} MB.`,
    };
  }

  // The bytes decide the type. A renamed HTML page must fail here, not at
  // Storage with a raw error the owner cannot act on.
  const sniffed = sniffImageMime(bytes);
  const claimed = (file.type || '').toLowerCase().trim();
  const pdfAllowed = kind === 'menu-photo' || kind === 'reference';
  const looksPdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';

  let mime: string;
  if (sniffed) {
    if (claimed && claimed !== sniffed && !(claimed === 'image/jpg' && sniffed === 'image/jpeg')) {
      return { ok: false, error: 'That file’s contents do not match its name. Choose the real image file.' };
    }
    mime = sniffed;
  } else if (looksPdf && pdfAllowed) {
    mime = 'application/pdf';
  } else if (looksPdf) {
    return { ok: false, error: 'A PDF can only be used as a menu or reference file.' };
  } else {
    return { ok: false, error: 'That file is not a JPG, PNG, WebP or readable PDF.' };
  }

  const dimensions = mime === 'application/pdf' ? null : imageDimensions(bytes);
  if (mime !== 'application/pdf' && !dimensions) {
    return { ok: false, error: 'That image is corrupt or truncated. Try another file.' };
  }

  return {
    ok: true,
    asset: {
      kind,
      bucket: ASSET_BUCKET_FOR[kind],
      mime,
      extension: EXTENSION[mime] ?? 'bin',
      bytes,
      byteSize: bytes.byteLength,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

/**
 * The object path: `{restaurantId}/{kind}-{uuid}.{ext}`.
 * The first segment is the tenant fence both the Storage policy and the
 * database CHECK read; the random suffix makes two uploads of different
 * content never collide, and a re-upload never silently overwrite an
 * original ("preserve original assets").
 */
export function assetObjectPath(restaurantId: string, kind: BrandAssetKind, extension: string): string {
  return `${restaurantId}/${kind}-${randomUUID()}.${extension}`;
}
