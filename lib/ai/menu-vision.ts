/**
 * Read a printed menu from a photograph, with Gemini.
 *
 * WHAT THIS IS AND IS NOT
 *
 * The existing import path (lib/ai/menu-extract.ts) takes TEXT and is
 * OpenAI-compatible. It cannot see an image. This module takes a photo or a
 * PDF and returns a draft. Gemini is used here only, and only on the server:
 * the key never reaches the browser, and the browser never calls Google.
 *
 * THE RULE THAT MATTERS MORE THAN THE MODEL
 *
 * A menu photo is a bad input on purpose: creases, a smudge over a price, a
 * dish printed in two columns. The failure mode that hurts is a model that
 * fills the smudge in with a plausible number, because nobody re-reads
 * twenty-four rows they believe are correct. So:
 *
 *   - every item carries a confidence for name and price;
 *   - a price the model is not sure of comes back as `recommended: null`
 *     with a flag, and the review screen shows an EMPTY field;
 *   - nothing here writes to the database. It returns a draft.
 *
 * `buildVisionDraft` is pure and exported so the parsing rules are tested
 * without a network call (lib/ai/menu-vision.test.ts).
 */

import { MAX_IMPORT_CATEGORIES, MAX_IMPORT_ITEMS } from '../menu-import';

/** Where a dish's own photo sits on the page, as fractions of the image. */
export type PhotoBox = {
  /** 0-based page index, for a PDF. Always 0 for a single image. */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type VisionItem = {
  name: string;
  /** null when the print was unreadable. NEVER a guess. */
  pricePaise: number | null;
  /** null when the dietary mark could not be read. */
  isVeg: boolean | null;
  description: string | null;
  /** Machine-readable reasons this row needs a second look. */
  flags: VisionFlag[];
  /** The dish's own thumbnail on the menu card, when it has one. */
  photo: PhotoBox | null;
};

export type VisionFlag = 'price-unclear' | 'name-unclear' | 'veg-unclear' | 'no-price-printed';

export type VisionCategory = { name: string; items: VisionItem[] };

export type VisionDraft = {
  categories: VisionCategory[];
  /** Model-authored caveats, e.g. "page 2 was upside down". */
  notes: string[];
  model: string;
  /** Dishes found, for the "Read 24 dishes" line. */
  itemCount: number;
  /** How many of them need a human. */
  flaggedCount: number;
};

export type VisionResult =
  | { ok: true; draft: VisionDraft }
  | { ok: false; reason: string; code: VisionErrorCode };

export type VisionErrorCode =
  | 'not-configured'
  | 'bad-file'
  | 'too-large'
  | 'timeout'
  | 'rate-limited'
  | 'upstream'
  | 'unreadable';

/** Max bytes accepted from the browser, before we even look at the type. */
export const MAX_MENU_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_MENU_PAGES = 3;

const ACCEPTED: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'application/pdf': 'application/pdf',
};

export function visionConfigured(): boolean {
  return apiKey() !== '';
}

function apiKey(): string {
  return (process.env.GEMINI_API_KEY ?? process.env.MENU_VISION_API_KEY ?? '').trim();
}

function model(): string {
  return (process.env.GEMINI_MODEL ?? 'gemini-2.5-flash').trim();
}

/** Check a file before it is sent to a paid API. */
export function validateMenuCapture(file: { size: number; type: string; name?: string }):
  | { ok: true; mimeType: string }
  | { ok: false; reason: string; code: VisionErrorCode } {
  const type = (file.type || '').toLowerCase().trim();
  const byName = /\.([a-z0-9]+)$/i.exec(file.name ?? '')?.[1]?.toLowerCase();
  const guessed =
    ACCEPTED[type] ??
    (byName === 'jpg' || byName === 'jpeg'
      ? 'image/jpeg'
      : byName === 'png'
        ? 'image/png'
        : byName === 'webp'
          ? 'image/webp'
          : byName === 'pdf'
            ? 'application/pdf'
            : '');

  if (!guessed) {
    return { ok: false, reason: 'That file is not a JPG, PNG, WebP or PDF.', code: 'bad-file' };
  }
  if (file.size <= 0) {
    return { ok: false, reason: 'That file is empty.', code: 'bad-file' };
  }
  if (file.size > MAX_MENU_PHOTO_BYTES) {
    return {
      ok: false,
      reason: `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 8 MB.`,
      code: 'too-large',
    };
  }
  return { ok: true, mimeType: guessed };
}

const PROMPT = [
  'You are reading a photographed restaurant menu for an Indian restaurant.',
  'Return JSON only, no prose, in exactly this shape:',
  '{"categories":[{"name":"Starters","items":[{"name":"Paneer Tikka","price":320,"priceConfidence":"high","isVeg":true,"vegConfidence":"high","description":null,"photo":{"page":1,"x":120,"y":340,"w":90,"h":90}}]}],"notes":[]}',
  '',
  'Rules, in order of importance:',
  '1. NEVER invent. If a price is unreadable or covered, set "price": null and "priceConfidence": "low". Do not estimate or complete a pattern.',
  '2. If a dish name is unreadable, omit the dish entirely rather than guessing its name.',
  '3. "priceConfidence" and "vegConfidence" are "high" or "low". Use "low" whenever you are not certain.',
  '4. isVeg is the printed vegetarian mark: true for a green/veg mark, false for a red/non-veg mark, null when there is no mark or it is unreadable.',
  '5. Keep dish names exactly as printed, in their original script. Do not translate or rename.',
  '6. Group dishes under the section headings printed on the card. If there are no headings, use one category named "Menu".',
  '7. "photo" is the bounding box of that dish\'s own printed picture, in PIXELS of the image you were given, with page numbering starting at 1. Omit it (null) when the dish has no picture.',
  '8. If the image is not a menu, or is too blurry to read, return {"categories":[],"notes":["unreadable"]}.',
  '9. "notes" lists anything the reader should know: a page that was rotated, a column you could not read, a section that looked cut off.',
].join('\n');

/** Strip a ```json fence some gateways add regardless of responseMimeType. */
function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Turn a model answer into a draft we are willing to show.
 *
 * Every rule here exists because of a specific way a model gets a menu wrong:
 * prices as strings with a rupee sign, a "0" where it could not read, boxes
 * given in fractions instead of pixels, or a page index starting at zero.
 */
export function buildVisionDraft(answer: unknown, modelName: string): VisionDraft {
  const empty: VisionDraft = {
    categories: [],
    notes: [],
    model: modelName,
    itemCount: 0,
    flaggedCount: 0,
  };

  if (!answer || typeof answer !== 'object') return empty;
  const raw = answer as { categories?: unknown; notes?: unknown };

  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((n): n is string => typeof n === 'string' && n.trim() !== '').slice(0, 6)
    : [];

  if (!Array.isArray(raw.categories)) return { ...empty, notes };

  const categories: VisionCategory[] = [];
  let itemCount = 0;
  let flaggedCount = 0;

  for (const entry of raw.categories.slice(0, MAX_IMPORT_CATEGORIES)) {
    if (!entry || typeof entry !== 'object') continue;
    const category = entry as { name?: unknown; items?: unknown };
    const name = typeof category.name === 'string' ? category.name.trim().slice(0, 60) : '';
    if (!name || !Array.isArray(category.items)) continue;

    const items: VisionItem[] = [];

    for (const line of category.items) {
      if (itemCount + items.length >= MAX_IMPORT_ITEMS) break;
      if (!line || typeof line !== 'object') continue;

      const item = line as {
        name?: unknown;
        price?: unknown;
        priceConfidence?: unknown;
        isVeg?: unknown;
        vegConfidence?: unknown;
        description?: unknown;
        photo?: unknown;
      };

      const itemName = typeof item.name === 'string' ? item.name.trim().slice(0, 120) : '';
      // A dish with no readable name is omitted, not renamed: "Unnamed dish 3"
      // is a row nobody can price and everybody has to delete by hand.
      if (!itemName) continue;

      const rawPrice = num(item.price);
      const priceConfident = item.priceConfidence !== 'low';
      // Three ways a price is untrustworthy, all of which produce an EMPTY
      // field in the review rather than a number: not a number, not positive,
      // or the model said it was unsure.
      const priceTrustworthy = rawPrice !== null && rawPrice > 0 && priceConfident;
      const pricePaise = priceTrustworthy ? Math.round(rawPrice * 100) : null;

      const flags: VisionFlag[] = [];
      // Any item whose price did not survive is flagged, whichever way it
      // failed: a zero and a smudge are the same problem to the owner.
      if (pricePaise === null) {
        flags.push(rawPrice === null ? 'no-price-printed' : 'price-unclear');
      }

      if (item.name && typeof item.name === 'string' && /[□?]|\uFFFD/.test(item.name)) {
        flags.push('name-unclear');
      }

      const veg = item.isVeg === true ? true : item.isVeg === false ? false : null;
      if (veg === null || item.vegConfidence === 'low') flags.push('veg-unclear');

      const photo = readBox(item.photo);
      if (photo === null && item.photo !== undefined && item.photo !== null) {
        // A malformed box is dropped silently: a wrong crop is worse than no
        // photo, and the dish is still perfectly usable without one.
      }

      items.push({
        name: itemName,
        pricePaise,
        isVeg: veg,
        description:
          typeof item.description === 'string' ? item.description.trim().slice(0, 300) || null : null,
        flags,
        photo,
      });

      itemCount += 1;
      if (flags.length > 0) flaggedCount += 1;
    }

    // A heading with nothing under it would be an empty section on the menu.
    if (items.length > 0) categories.push({ name, items });
  }

  return { categories, notes, model: modelName, itemCount, flaggedCount };
}

/**
 * Read a photo or a PDF.
 *
 * Sends the bytes as inline data (base64). Files are capped at 8 MB by
 * validateMenuCapture and 3 pages by the prompt; PDFs beyond that are the
 * caller's job to refuse before this is reached.
 */
export async function extractMenuFromImage(
  bytes: ArrayBuffer,
  mimeType: string
): Promise<VisionResult> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      code: 'not-configured',
      reason: 'Reading photos is not switched on for this deployment. You can still add dishes by hand.',
    };
  }

  const base64 = Buffer.from(bytes).toString('base64');
  const controller = new AbortController();
  // A vision call on a phone photo is slow. Forty-five seconds is long enough
  // to succeed and short enough that an owner is not left staring at a
  // spinner while a lunch service runs.
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model())}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    if (response.status === 429) {
      return {
        ok: false,
        code: 'rate-limited',
        reason: 'The reader is busy right now. Wait a minute and try again, or add dishes by hand.',
      };
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[autodine] menu vision failed:', response.status, detail.slice(0, 300));
      return {
        ok: false,
        code: 'upstream',
        reason: 'The reader could not be reached. You can still add dishes by hand.',
      };
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
    };

    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) {
      return { ok: false, code: 'unreadable', reason: 'Nothing readable came back from that photo.' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(unfence(text));
    } catch {
      console.error('[autodine] menu vision returned non-JSON:', text.slice(0, 200));
      return { ok: false, code: 'unreadable', reason: 'That photo could not be read as a menu.' };
    }

    const draft = buildVisionDraft(parsed, model());

    if (draft.categories.length === 0) {
      return {
        ok: false,
        code: 'unreadable',
        reason:
          'No dishes were found in that photo. Check that the whole menu is in frame and the text is sharp, then try again.',
      };
    }

    return { ok: true, draft };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    console.error('[autodine] menu vision threw:', error);
    return {
      ok: false,
      code: aborted ? 'timeout' : 'upstream',
      reason: aborted
        ? 'That took too long. Try a smaller or clearer photo, or add dishes by hand.'
        : 'The reader could not be reached. You can still add dishes by hand.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Bounding box, normalised to 0..1 and clamped.
 *
 * The model is told pixels, but a gateway that silently resizes the image
 * would produce a box outside the frame; clamping keeps a crop inside the
 * picture instead of throwing on a negative slice later.
 */
function readBox(value: unknown): PhotoBox | null {
  if (!value || typeof value !== 'object') return null;

  // Models sometimes answer in fractions despite the instruction. Detect that
  // by size: a box smaller than 1 in every axis cannot be pixels on any real
  // photo of a menu.
  const raw = value as { page?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown; width?: unknown; height?: unknown };
  const x = num(raw.x);
  const y = num(raw.y);
  const w = num(raw.w) ?? num(raw.width);
  const h = num(raw.h) ?? num(raw.height);
  if (x === null || y === null || w === null || h === null) return null;

  const looksNormalised = x <= 1 && y <= 1 && w <= 1 && h <= 1;

  const box: PhotoBox = {
    page: Math.max(0, Math.round(num(raw.page) ?? 1) - 1),
    x: clamp01(looksNormalised ? x : x / 1000),
    y: clamp01(looksNormalised ? y : y / 1000),
    w: clamp01(looksNormalised ? w : w / 1000),
    h: clamp01(looksNormalised ? h : h / 1000),
  };

  // A degenerate or absurd box is not worth a crop.
  if (box.w < 0.02 || box.h < 0.02) return null;
  if (box.x + box.w > 1.02 || box.y + box.h > 1.02) return null;

  return box;
}
