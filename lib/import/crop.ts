'use client';

/**
 * Crop a dish photo out of the menu photograph, in the browser.
 *
 * WHY THE BROWSER AND NOT THE SERVER
 *
 * Cropping needs an image decoder. Node has none built in, and adding `sharp`
 * would drop a native build step into the install path of every deployment for
 * one feature. The browser already has a decoder, already holds the file the
 * owner picked, and canvas is fast enough for a handful of thumbnails.
 *
 * The output is deliberately small: a 512px JPEG at quality 0.82 is ~40-80 KB,
 * which is what a menu thumbnail needs and well inside the 600 KB the server
 * accepts per crop.
 */

import type { PhotoBox } from '@/lib/ai/menu-vision';

const MAX_EDGE = 512;

export type CropResult = { dataUrl: string; bytes: number };

/**
 * Cut one box out of an image file.
 *
 * `box` is normalised 0..1 (see buildVisionDraft). Returns null when the crop
 * would be empty -- a bad box must produce no photo, never a broken one.
 */
export async function cropFromImage(file: File, box: PhotoBox): Promise<CropResult | null> {
  const bitmap = await loadBitmap(file);
  if (!bitmap) return null;

  try {
    const sourceWidth = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
    const sourceHeight = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
    if (!sourceWidth || !sourceHeight) return null;

    const sx = Math.max(0, Math.round(box.x * sourceWidth));
    const sy = Math.max(0, Math.round(box.y * sourceHeight));
    const sw = Math.min(sourceWidth - sx, Math.round(box.w * sourceWidth));
    const sh = Math.min(sourceHeight - sy, Math.round(box.h * sourceHeight));
    if (sw < 8 || sh < 8) return null;

    const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // A flat paper background first: a PNG with transparency would otherwise
    // show black where the menu card had white paper.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(bitmap as CanvasImageSource, sx, sy, sw, sh, 0, 0, dw, dh);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    // 0.37 converts base64 characters back to approximate bytes.
    return { dataUrl, bytes: Math.round(dataUrl.length * 0.75) };
  } catch {
    return null;
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

type Decodable = ImageBitmap | HTMLImageElement;

async function loadBitmap(file: File): Promise<Decodable | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through: Safari has had createImageBitmap throw on large JPEGs,
      // and the <img> path below handles the same file.
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
