import { describe, expect, it } from 'vitest';
import {
  imageDimensions,
  jpegDimensions,
  pngDimensions,
  sniffImageMime,
  webpDimensions,
} from './image-meta';

/** A real PNG header: signature + IHDR with 123×45. */
function png(width = 123, height = 45): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

/** JPEG: SOI + APP0 + SOF0 carrying 480×640. */
function jpeg(width = 640, height = 480): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0xff, 0xd8], 0);
  // APP0 segment with a 16-byte length so the walker moves past it.
  bytes.set([0xff, 0xe0, 0x00, 0x10], 2);
  // SOF0 at offset 20: marker, length 8+3, precision, height, width.
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  new DataView(bytes.buffer).setUint16(25, height);
  new DataView(bytes.buffer).setUint16(27, width);
  return bytes;
}

/** WebP lossless: RIFF/WEBP/VP8L with 14-bit (w-1)/(h-1) fields. */
function webpLossless(width = 300, height = 200): Uint8Array {
  const bytes = new Uint8Array(25);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  bytes[20] = 0x2f; // lossless signature byte
  const bits = (width - 1) | ((height - 1) << 14);
  new DataView(bytes.buffer).setUint32(21, bits, true);
  return bytes;
}

/** WebP extended: VP8X with 24-bit canvas width-1 / height-1. */
function webpExtended(width = 1000, height = 500): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  bytes[24] = (width - 1) & 0xff;
  bytes[25] = ((width - 1) >> 8) & 0xff;
  bytes[26] = ((width - 1) >> 16) & 0xff;
  bytes[27] = (height - 1) & 0xff;
  bytes[28] = ((height - 1) >> 8) & 0xff;
  bytes[29] = ((height - 1) >> 16) & 0xff;
  return bytes;
}

describe('image dimension parsers', () => {
  it('reads PNG IHDR dimensions', () => {
    expect(pngDimensions(png(123, 45))).toEqual({ width: 123, height: 45 });
  });

  it('reads JPEG SOF0 dimensions, skipping APP markers', () => {
    expect(jpegDimensions(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('reads both lossless and extended WebP', () => {
    expect(webpDimensions(webpLossless(300, 200))).toEqual({ width: 300, height: 200 });
    expect(webpDimensions(webpExtended(1000, 500))).toEqual({ width: 1000, height: 500 });
  });

  it('sniffs each format and refuses junk', () => {
    expect(sniffImageMime(png())).toBe('image/png');
    expect(sniffImageMime(jpeg())).toBe('image/jpeg');
    expect(sniffImageMime(webpLossless())).toBe('image/webp');
    expect(sniffImageMime(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]))).toBeNull();
  });

  it('returns null rather than guessing on corrupt or truncated files', () => {
    expect(imageDimensions(new Uint8Array(0))).toBeNull();
    expect(imageDimensions(new Uint8Array([0x89, 0x50]))).toBeNull();
    // A PNG signature with absurd dimensions is refused, not clamped silently.
    expect(pngDimensions(png(0, -1))).toBeNull();
    // A JPEG that never reaches SOF.
    const soiless = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(jpegDimensions(soiless)).toBeNull();
    // A WebP with an unknown chunk type.
    const unknown = webpLossless();
    unknown.set([0x58, 0x58, 0x58, 0x58], 12);
    expect(webpDimensions(unknown)).toBeNull();
  });

  it('does not trust a mislabelled payload: sniffing decides the parser', () => {
    // PNG bytes are never read by the JPEG parser even if the file claims jpeg.
    expect(jpegDimensions(png())).toBeNull();
    expect(imageDimensions(png())).toEqual({ width: 123, height: 45 });
  });
});
