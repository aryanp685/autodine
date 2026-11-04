/**
 * Read a restaurant's VISUAL IDENTITY from a photograph of its printed menu
 * or its reference images, with the same Gemini configuration the menu reader
 * uses.
 *
 * WHAT THIS IS AND IS NOT
 *
 * The menu reader (lib/ai/menu-vision.ts) answers "what can I order". This
 * answers "whose menu is this and what does it look like". Same provider,
 * same key (`GEMINI_API_KEY`), same discipline — and the same refusal to
 * guess:
 *
 *   - a decorative graphic is NOT the official logo unless the model is sure
 *     it is the restaurant's own mark — and even then it comes back as a
 *     CANDIDATE with a confidence, never as the logo;
 *   - an unreadable colour comes back null, never a plausible hex;
 *   - nothing here writes to the database. It returns a structured answer
 *     that lib/branding/resolve.ts merges with the owner's own uploads.
 *
 * `buildBrandExtraction` is pure and exported so the parsing rules are tested
 * without a network call (lib/ai/brand-vision.test.ts).
 */

import { readBox, validateMenuCapture, type PhotoBox, type VisionErrorCode } from './menu-vision';
import { callGeminiJson, geminiConfigured } from './gemini';
import {
  parseHex,
  parseTheme,
  type FontCharacter,
  type Motif,
  type HeaderStyle,
  type CardRadius,
  type CardBorder,
  type CardElevation,
  type Spacing,
} from '../branding/theme';

export type Confidence = 'high' | 'low';

export type BrandExtraction = {
  model: string;
  name: string | null;
  nameConfidence: Confidence | null;
  /** Candidate box of the restaurant's own printed mark. NULL unless sure. */
  logoBox: PhotoBox | null;
  logoConfidence: Confidence | null;
  bannerBox: PhotoBox | null;
  colors: {
    primary: string | null;
    primaryConfidence: Confidence | null;
    secondary: string[];
    background: string | null;
    surface: string | null;
  };
  typography: {
    character: FontCharacter | null;
    exactFont: string | null;
  };
  layout: {
    header: HeaderStyle | null;
    card: {
      radius: CardRadius | null;
      border: CardBorder | null;
      elevation: CardElevation | null;
    };
    spacing: Spacing | null;
    motifs: Motif[];
  };
  notes: string[];
};

export type BrandResult =
  | { ok: true; extraction: BrandExtraction }
  | { ok: false; reason: string; code: VisionErrorCode };

/** Same acceptance and ceilings as the menu reader — one upload, one policy. */
export const validateBrandCapture = validateMenuCapture;

export function brandVisionConfigured(): boolean {
  return geminiConfigured();
}

const PROMPT = [
  'You are reading a photographed Indian restaurant menu (or a brand reference image) to describe its VISUAL IDENTITY.',
  'Return JSON only, no prose, in exactly this shape:',
  '{"name":"Punjabi Rasoi","nameConfidence":"high","logoBox":{"page":1,"x":120,"y":30,"w":90,"h":90},"logoConfidence":"low","bannerBox":null,',
  '"colors":{"primary":"#7a1f2b","primaryConfidence":"high","secondary":["#d9a441"],"background":"#faf3e6","surface":"#ffffff"},',
  '"typography":{"character":"serif","exactFont":"Didot"},',
  '"layout":{"header":"banner-overlay","card":{"radius":"soft","border":"hairline","elevation":"flat"},"spacing":"regular","motifs":["rule-double"]},',
  '"notes":[]}',
  '',
  'Rules, in order of importance:',
  '1. "logoBox" is the bounding box of the restaurant LOGO or wordmark ONLY, in PIXELS of the image you were given (page numbering from 1). A decorative graphic, a dish photo or a border ornament is NOT a logo. If you are not sure the mark is the restaurant logo, use null and say so in notes.',
  '2. "bannerBox" is the box of a large cover image or header photograph, if the page has one. null otherwise.',
  '3. Colours: read the DOMINANT brand colours actually printed. If a colour cannot be read, use null. NEVER invent or complete a colour.',
  '4. "typography.character" is ONE of: serif, sans, condensed, script, mono — the closest character of the printed headings. "exactFont" is the font name only if it is printed or unmistakable, else null.',
  '5. "layout.header" is ONE of: banner-overlay, banner-stack, plain. "card.radius" is ONE of: none, soft, round. "card.border" is ONE of: none, hairline, frame. "card.elevation" is ONE of: flat, lifted. "spacing" is ONE of: compact, regular, airy.',
  '6. "motifs" is a subset of: rule-double, divider-swirl, corner-ornament, dot-separator. Use ONLY motifs clearly visible as repeating decorative elements. Empty list when there are none.',
  '7. "name" is the restaurant name exactly as printed, with its spelling. Null if the image does not show one.',
  '8. If the image is not a menu or brand reference, or is unreadable, return {"name":null,"nameConfidence":null,"logoBox":null,"logoConfidence":null,"bannerBox":null,"colors":{"primary":null,"primaryConfidence":null,"secondary":[],"background":null,"surface":null},"typography":{"character":null,"exactFont":null},"layout":null,"notes":["unreadable"]}.',
  '9. "notes" lists anything the owner should know: "the mark in the corner looked decorative, not a logo", "two column layouts", "a page that was rotated".',
].join('\n');

function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function confidence(value: unknown): Confidence | null {
  return value === 'high' || value === 'low' ? value : null;
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}

function oneOf<T>(list: readonly T[], value: unknown): T | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase() as T;
  return (list as readonly string[]).includes(v as string) ? v : null;
}

const FONT_CHARACTERS: readonly FontCharacter[] = ['serif', 'sans', 'condensed', 'script', 'mono'];
const MOTIFS: readonly Motif[] = ['none', 'rule-double', 'divider-swirl', 'corner-ornament', 'dot-separator'];
const HEADERS: readonly HeaderStyle[] = ['banner-overlay', 'banner-stack', 'plain'];
const RADII: readonly CardRadius[] = ['none', 'soft', 'round'];
const BORDERS: readonly CardBorder[] = ['none', 'hairline', 'frame'];
const ELEVATIONS: readonly CardElevation[] = ['flat', 'lifted'];
const SPACINGS: readonly Spacing[] = ['compact', 'regular', 'airy'];

/**
 * Model answer → extraction we are willing to show.
 *
 * Every rule exists because of a way a model gets a brand wrong: a hex with
 * a rupee-sign-sized typo, a confidence it forgot to give, a "logo" that is
 * the picture of a dish, a motif list invented from nothing. Colours go
 * through parseHex (via parseTheme's rules), boxes through readBox, and
 * anything that does not survive comes back null — the review screen then
 * asks the owner instead of trusting a guess.
 */
export function buildBrandExtraction(answer: unknown, modelName: string): BrandExtraction {
  const empty: BrandExtraction = {
    model: modelName,
    name: null,
    nameConfidence: null,
    logoBox: null,
    logoConfidence: null,
    bannerBox: null,
    colors: { primary: null, primaryConfidence: null, secondary: [], background: null, surface: null },
    typography: { character: null, exactFont: null },
    layout: { header: null, card: { radius: null, border: null, elevation: null }, spacing: null, motifs: [] },
    notes: [],
  };

  if (!answer || typeof answer !== 'object') return empty;
  const raw = answer as Record<string, unknown>;

  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .map((n) => str(n, 200))
    .filter((n): n is string => n !== null)
    .slice(0, 6);

  // The theme parser is reused as the colour/enum gate: an assembled
  // theme-shaped object goes through parseTheme, which keeps ONE definition
  // of "valid" for both the model output and the owner's edits.
  const colors = (raw.colors ?? {}) as Record<string, unknown>;
  const secondaryRaw = Array.isArray(colors.secondary) ? colors.secondary : [];
  // Each secondary is validated on its own: a bad one is dropped, the good
  // ones survive (the old shape lost every colour after the first).
  const secondaryParsed = secondaryRaw
    .map((c) => parseHex(c))
    .filter((c): c is string => c !== null)
    .slice(0, 4);

  const probe = parseTheme({
    colors: {
      primary: colors.primary ?? '#000000',
      secondary: secondaryParsed[0] ?? null,
      background: colors.background ?? null,
      surface: colors.surface ?? null,
    },
    typography: raw.typography ?? {},
    layout: raw.layout ?? {},
  });

  const primaryParsed =
    typeof colors.primary === 'string' && probe ? probe.colors.primary : null;

  const typographyRaw = (raw.typography ?? {}) as Record<string, unknown>;
  const layoutRaw = (raw.layout ?? {}) as Record<string, unknown>;
  const cardRaw = (layoutRaw.card ?? {}) as Record<string, unknown>;
  const motifsRaw = Array.isArray(layoutRaw.motifs) ? layoutRaw.motifs : [];
  const motifs = motifsRaw
    .map((m) => oneOf(MOTIFS, m))
    .filter((m): m is Motif => m !== null && m !== 'none')
    .slice(0, 4);

  const logoBox = readBox(raw.logoBox);
  const logoConfidence = confidence(raw.logoConfidence);
  // A logo box without a confidence is a box we cannot vouch for: drop it.
  const logo = logoBox && logoConfidence ? { logoBox, logoConfidence } : null;

  return {
    model: modelName,
    name: str(raw.name, 80),
    nameConfidence: confidence(raw.nameConfidence),
    logoBox: logo?.logoBox ?? null,
    logoConfidence: logo?.logoConfidence ?? null,
    bannerBox: readBox(raw.bannerBox),
    colors: {
      primary: primaryParsed,
      primaryConfidence: confidence(raw.primaryConfidence ?? colors.primaryConfidence),
      secondary: secondaryParsed.slice(0, 4),
      background: probe?.colors.background ?? null,
      surface: probe?.colors.surface ?? null,
    },
    typography: {
      character: oneOf(FONT_CHARACTERS, typographyRaw.character),
      exactFont: str(typographyRaw.exactFont, 60),
    },
    layout: {
      header: oneOf(HEADERS, layoutRaw.header),
      card: {
        radius: oneOf(RADII, cardRaw.radius),
        border: oneOf(BORDERS, cardRaw.border),
        elevation: oneOf(ELEVATIONS, cardRaw.elevation),
      },
      spacing: oneOf(SPACINGS, layoutRaw.spacing),
      motifs,
    },
    notes,
  };
}

/**
 * Read one photo (or PDF page set) for its visual identity.
 * Server-only: the API key never leaves this process.
 */
export async function extractBrandFromImage(bytes: ArrayBuffer, mimeType: string): Promise<BrandResult> {
  const result = await callGeminiJson({
    prompt: PROMPT,
    bytes,
    mimeType,
    maxOutputTokens: 4096,
    busyReason: 'The reader is busy right now. Wait a minute and try again, or set your logo and colour by hand.',
    unreachableReason: 'The reader could not be reached. You can still set your logo and colour by hand.',
    timeoutReason: 'That took too long. Try a smaller or clearer image, or set things up by hand.',
    modelMissingReason:
      'The reader is not available on this deployment right now. You can still set your logo and colour by hand.',
  });
  if (!result.ok) return { ok: false, code: result.code, reason: result.reason };

  const text = result.text;
  if (!text.trim()) {
    return { ok: false, code: 'unreadable', reason: 'Nothing readable came back from that image.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(text));
  } catch {
    console.error('[autodine] brand vision returned non-JSON:', text.slice(0, 200));
    return { ok: false, code: 'unreadable', reason: 'That image could not be read as brand material.' };
  }

  return { ok: true, extraction: buildBrandExtraction(parsed, result.model) };
}
