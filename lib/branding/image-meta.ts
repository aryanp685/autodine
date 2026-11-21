/**
 * Image metadata without an image library.
 *
 * WHY THIS EXISTS
 *
 * Phase 1 of the Brand Studio requires every stored asset to carry its MIME
 * type, byte size, pixel dimensions and checksum. Adding sharp or image-size
 * for three header formats would be a native dependency and a build risk
 * (Part 5: "avoid unnecessary dependencies"), and the formats are closed and
 * tiny at the header level:
 *
 *   PNG  — IHDR chunk at a fixed offset.
 *   JPEG — walk the marker segments to SOFn (the SOF0..SOF15 family, minus
 *          the ones that are not frame headers).
 *   WebP — RIFF container: VP8 (lossy), VP8L (lossless) or VP8X (extended)
 *          each carry the dimensions in their own first bytes.
 *
 * The parsers are pure and total: any file that does not parse returns null
 * and the caller reports "dimensions unknown" rather than guessing. A wrong
 * dimension is worse than none — it would render a layout around a lie.
 *
 * `checksum` is server-side only (node:crypto): a browser has SubtleCrypto
 * but the upload actions run in Node and this keeps one code path.
 */

export type ImageDimensions = { width: number; height: number };

const MAX_DIMENSION = 20_000;

function clampDimension(value: number): number | null {
  return Number.isInteger(value) && value > 0 && value <= MAX_DIMENSION ? value : null;
}

/** PNG: 8-byte signature, then IHDR with width/height as big-endian uint32. */
export function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i += 1) if (bytes[i] !== sig[i]) return null;
  // The IHDR chunk type sits at offset 12, its data at 16.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = clampDimension(view.getUint32(16));
  const height = clampDimension(view.getUint32(20));
  return width && height ? { width, height } : null;
}

/** JPEG: walk 0xFF marker segments until a SOF frame header. */
export function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // 0xD8 SOI, 0xD9 EOI, 0x01 tem and RSTn have no length segment.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    // SOF0..SOF15 except DHT(c4), JPG(c8) and DAC(cc) — the frame headers.
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = clampDimension(view.getUint16(offset + 5));
      const width = clampDimension(view.getUint16(offset + 7));
      return width && height ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

/** WebP: RIFF container; the chunk type at offset 12 decides the layout. */
export function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 16) return null;
  const ascii = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = ascii(12);
  if (chunk === 'VP8 ') {
    // Lossy: frame tag 3 bytes, sync code 3 bytes, then 14-bit width/height.
    if (bytes.length < 30) return null;
    const width = clampDimension(view.getUint16(26) & 0x3fff);
    const height = clampDimension(view.getUint16(28) & 0x3fff);
    return width && height ? { width, height } : null;
  }
  if (chunk === 'VP8L') {
    // Lossless: 1 signature byte then 14+14 bits of (w-1)/(h-1).
    if (bytes.length < 25) return null;
    const bits = view.getUint32(21, true);
    const width = clampDimension((bits & 0x3fff) + 1);
    const height = clampDimension(((bits >> 14) & 0x3fff) + 1);
    return width && height ? { width, height } : null;
  }
  if (chunk === 'VP8X') {
    // Extended: 24-bit canvas width-1 / height-1, little-endian.
    if (bytes.length < 30) return null;
    const width = clampDimension(1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)));
    const height = clampDimension(1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)));
    return width && height ? { width, height } : null;
  }
  return null;
}

/**
 * Dimensions for whichever of the three we accept, or null.
 *
 * The MIME type is checked by `validateImage` before this runs; this function
 * still sniffs the bytes, because "image/png" from a lying browser must not
 * produce a confident measurement from the wrong parser.
 */
export function imageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return pngDimensions(bytes) ?? jpegDimensions(bytes) ?? webpDimensions(bytes);
}

/**
 * The real MIME type, by signature. The second fence after `file.type`:
 * a .png rename of an HTML page must fail upload, not reach Storage.
 */
export function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (pngDimensions(bytes) !== null) return 'image/png';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 12) {
    const ascii = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[8], bytes[9], bytes[10], bytes[11]);
    if (ascii === 'RIFFWEBP') return 'image/webp';
  }
  return null;
}
