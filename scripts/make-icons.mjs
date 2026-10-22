#!/usr/bin/env node
/**
 * Draw the app icons.
 *
 * WHY A SCRIPT AND NOT THREE FILES IN GIT
 *
 * The icons are the first thing a phone shows after "Add to Home Screen", and
 * a wrong-sized or half-transparent one is visible forever. Generating them
 * from one description means the mark can be changed by editing numbers here,
 * instead of someone opening an image editor and hoping they matched the
 * previous radius.
 *
 * No image library is used on purpose: this repo has no native build step, and
 * adding `sharp` for three static PNGs would put a compiler in the install
 * path of every deployment. A PNG is a header, a zlib stream and a CRC, which
 * Node can produce by itself.
 *
 * Run:  node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');

/** Deep green. Matches the `forest` accent in lib/branding/palette.ts. */
const INK = [0x26, 0x66, 0x4f];
const PAPER = [0xf8, 0xf5, 0xef];

/* ------------------------------------------------------------------ shapes */

/** Antialiased coverage of "is this point inside the mark", in mark space 0..1. */
function coverage(x, y) {
  // A plated dish on a table: a ring, and a bar under it. Both are drawn with
  // signed distance so the edges stay crisp at every size.
  const ringR = 0.225;
  const ringW = 0.044;
  const cx = 0.5;
  const cy = 0.44;
  const d = Math.hypot(x - cx, y - cy);
  const inRing = Math.abs(d - ringR) <= ringW / 2;

  const barY = 0.755;
  const barH = 0.05;
  const barHalf = 0.185;
  const inBar = Math.abs(y - barY) <= barH / 2 && Math.abs(x - 0.5) <= barHalf;

  const inDot = d <= 0.072;

  return inRing || inBar || inDot;
}

/* --------------------------------------------------------------- PNG writer */

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {number} size
 * @param {{ rounded: boolean, inset: number }} opts
 *   rounded  square with rounded corners (the "any" icon)
 *   inset    fraction of the canvas the mark is scaled into, for the maskable
 *            icon's safe zone -- Android crops maskable icons to a circle, so
 *            the glyph has to live well inside the edge
 */
function draw(size, { rounded, inset }) {
  const px = Buffer.alloc(size * size * 4);
  const samples = 4; // 4x4 supersampling
  const radius = 0.22; // corner radius, in canvas space

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let plate = 0;
      let body = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;

          // Rounded-square body.
          let inside = true;
          if (rounded) {
            const r = radius;
            const cx = Math.min(Math.max(u, r), 1 - r);
            const cy = Math.min(Math.max(v, r), 1 - r);
            inside = Math.hypot(u - cx, v - cy) <= r + 1e-6;
          }
          if (inside) body += 1;

          // The glyph, mapped into the safe zone.
          const gx = (u - 0.5) / inset + 0.5;
          const gy = (v - 0.5) / inset + 0.5;
          if (inside && coverage(gx, gy)) plate += 1;
        }
      }

      const total = samples * samples;
      const alpha = Math.round((body / total) * 255);
      const glyph = body === 0 ? 0 : plate / body;
      const rgb = INK.map((c, i) => Math.round(c * (1 - glyph) + PAPER[i] * glyph));

      const o = (y * size + x) * 4;
      px[o] = rgb[0];
      px[o + 1] = rgb[1];
      px[o + 2] = rgb[2];
      px[o + 3] = alpha;
    }
  }

  return png(size, px);
}

mkdirSync(OUT, { recursive: true });

const files = [
  ['icon-192.png', 192, { rounded: true, inset: 0.92 }],
  ['icon-512.png', 512, { rounded: true, inset: 0.92 }],
  // Maskable: full bleed, glyph pulled in so a circular crop cannot clip it.
  ['maskable-512.png', 512, { rounded: false, inset: 0.62 }],
  // iOS ignores the manifest's maskable hint and composites its own mask.
  ['apple-touch-icon.png', 180, { rounded: false, inset: 0.82 }],
];

for (const [name, size, opts] of files) {
  writeFileSync(join(OUT, name), draw(size, opts));
  console.log(`wrote public/icons/${name} (${size}x${size})`);
}
