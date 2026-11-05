/**
 * Translating the menu — names and descriptions into हिन्दी or मराठी.
 *
 * WHY THIS EXISTS AT ALL
 *
 * A kitchen in Nagpur feeds guests who read three scripts. The owner wrote
 * one menu; this writes the other copies — and only the copies. The
 * original text is never sent back, never edited, never "improved" here.
 *
 * WHAT IS DELIBERATELY NOT HAPPENING HERE
 *
 * Nothing is added and nothing is dropped. A translation carries the same
 * claims as its source — no invented ingredients from a thin name, no
 * price, no new dish. Portions and dish names stay recognizable: "Paneer
 * Tikka" becomes its Devanagari form, not a different dish. An empty
 * description stays empty. When a row cannot be translated honestly, it
 * comes back as a per-row failure the owner sees, never as source text
 * wearing the target language's label.
 */

import { callTextJson, geminiConfigured } from './gemini';
import { groqConfigured } from './groq';
import type { LanguageCode } from '../i18n/translations';

/** One row awaiting translation — an item (with description) or a category (name only). */
export type TranslateTarget = {
  id: string;
  name: string;
  description: string;
};

export type TranslateResult =
  | { id: string; ok: true; name: string; description: string }
  | { id: string; ok: false; reason: string };

/** Names hold the same cap as the editor; descriptions the writer's cap. */
export const MAX_TRANSLATED_NAME = 120;
export const MAX_TRANSLATED_DESCRIPTION = 300;

/** Per model call. */
const CHUNK = 10;

const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  hi: 'Hindi (Devanagari script)',
  mr: 'Marathi (Devanagari script)',
};

export function translateConfigured(): boolean {
  return geminiConfigured() || groqConfigured();
}

/** Strip the ```json fences some models wrap answers in. */
function unfence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return fenced ? fenced[1] : text;
}

function buildPrompt(targets: readonly TranslateTarget[], language: LanguageCode): string {
  const lines = targets.map((target, index) => {
    const parts = [`${index + 1}. name: ${JSON.stringify(target.name)}`];
    parts.push(`description: ${JSON.stringify(target.description)}`);
    return parts.join(', ');
  });
  return [
    `You translate restaurant menu rows into ${LANGUAGE_NAMES[language]}.`,
    'Rules for every row:',
    '- Translate the name and the description faithfully. Carry exactly the same claims — add nothing, drop nothing.',
    '- Keep dish names recognizable (a dish name may be transliterated into Devanagari, never replaced by a different dish).',
    '- Never invent ingredients, preparation, or origin the source does not state. Never translate or add a price.',
    '- An empty description stays empty ("").',
    '- The name is at most 120 characters, the description at most 300.',
    '- If a row cannot be translated faithfully, use null for that row instead of guessing.',
    '',
    'Rows:',
    ...lines,
    '',
    'Reply with JSON only, in this exact shape:',
    `{"items": [{"name": "…", "description": "…"}, null]}`,
    `The "items" array must have exactly ${targets.length} entries, in the same order. Each entry is {"name": string, "description": string} or null.`,
  ].join('\n');
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TRANSLATED_NAME);
}

function cleanDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TRANSLATED_DESCRIPTION);
}

/**
 * Translate a batch of rows. Per-row results — the owner's review must show
 * exactly which rows came back and which did not, and why.
 */
export async function translateBatch(
  targets: readonly TranslateTarget[],
  language: LanguageCode
): Promise<TranslateResult[]> {
  if (targets.length === 0) return [];

  if (!translateConfigured()) {
    return targets.map((target) => ({
      id: target.id,
      ok: false as const,
      reason: 'Translation is not switched on for this deployment.',
    }));
  }

  const results: TranslateResult[] = [];

  for (let start = 0; start < targets.length; start += CHUNK) {
    const chunk = targets.slice(start, start + CHUNK);

    const result = await callTextJson({
      prompt: buildPrompt(chunk, language),
      maxOutputTokens: 4096,
      busyReason: 'The translator is busy right now. Wait a minute and try again.',
      unreachableReason: 'The translator could not be reached. Your menu is unchanged.',
      timeoutReason: 'That took too long. Try again — your menu is unchanged.',
      modelMissingReason: 'The translator is not available on this deployment right now.',
    });

    if (!result.ok) {
      for (const target of chunk) results.push({ id: target.id, ok: false, reason: result.reason });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(unfence(result.text));
    } catch {
      console.error('[autodine] translator returned non-JSON:', result.text.slice(0, 200));
      for (const target of chunk) {
        results.push({ id: target.id, ok: false, reason: 'The translator returned something unreadable. Try again.' });
      }
      continue;
    }

    const items = (parsed as { items?: unknown })?.items;
    const answers = Array.isArray(items) ? items : [];

    chunk.forEach((target, index) => {
      const answer = answers[index] as { name?: unknown; description?: unknown } | null;
      if (!answer || typeof answer !== 'object' || typeof answer.name !== 'string') {
        results.push({
          id: target.id,
          ok: false,
          reason: 'The translator could not translate this one faithfully. Edit it by hand.',
        });
        return;
      }
      const name = cleanName(answer.name);
      const description = typeof answer.description === 'string' ? cleanDescription(answer.description) : '';
      if (name === '') {
        results.push({ id: target.id, ok: false, reason: 'The translator returned an empty name. Try again.' });
        return;
      }
      results.push({ id: target.id, ok: true, name, description });
    });
  }

  return results;
}
