/**
 * Optional: read a menu with a language model instead of rules.
 *
 * WHY THIS IS OPTIONAL AND STAYS HONEST
 *
 * There is no model key in this deployment. A button labelled "AI" that posts
 * to a service returning 401, or that silently falls back to the rule parser
 * while still claiming the model read the menu, is worse than no button. So:
 *
 *   - menuAiConfigured() is asked before the screen offers the AI path;
 *   - when it is off, the screen says the rule parser is doing the work;
 *   - when it is on and the call fails, the caller is told, and the paste is
 *     parsed by the rules instead — with that stated, not hidden.
 *
 * The endpoint is OpenAI-compatible (base URL overridable) because the point
 * is not one vendor: a restaurant group running its own gateway sets
 * MENU_AI_BASE_URL and nothing else changes.
 *
 * THE MODEL PRODUCES A DRAFT, NOT ROWS
 *
 * Its answer goes through draftFromAiAnswer() and then the same sanitiser a
 * browser-posted draft goes through. A hallucinated price or a duplicated
 * section cannot reach the database, and the owner reviews every dish before
 * anything is written.
 */

import { draftFromAiAnswer, type MenuImportDraft } from '../menu-import';

export type AiMenuResult =
  | { ok: true; draft: MenuImportDraft; model: string }
  | { ok: false; reason: string };

function apiKey(): string {
  return (process.env.MENU_AI_API_KEY ?? process.env.OPENAI_API_KEY ?? '').trim();
}

function baseUrl(): string {
  return (process.env.MENU_AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function model(): string {
  return (process.env.MENU_AI_MODEL ?? 'gpt-4o-mini').trim();
}

/** True when a key is configured. The screen asks this before offering AI. */
export function menuAiConfigured(): boolean {
  return apiKey() !== '';
}

/** What the model is asked for, worded so a wrong answer is unlikely. */
const SYSTEM_PROMPT = [
  'You extract a restaurant menu from text a restaurant owner pasted.',
  'Return JSON only, no prose, in exactly this shape:',
  '{"categories":[{"name":"Starters","items":[{"name":"Paneer Tikka","price":320,"isVeg":true,"description":null}]}]}',
  'Rules: price is a number in rupees, never a string and never with a currency symbol.',
  'Keep dish names as written; do not translate, rename, or invent dishes.',
  'Never invent a price. If a line has no price, leave that dish out.',
  'isVeg is false only for dishes that contain meat, fish, prawn or egg.',
  'If the text is not a menu, return {"categories":[]}.',
].join('\n');

/** Strip a ```json fence if the gateway ignored response_format. */
function unfence(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

export async function extractMenuWithAi(text: string): Promise<AiMenuResult> {
  const key = apiKey();
  if (!key) return { ok: false, reason: 'No model key is configured on this deployment.' };

  const controller = new AbortController();
  // A menu is small; if the gateway has not answered in twenty seconds the
  // owner is better served by the rule parser than by a spinner.
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model(),
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, 12_000) },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[autodine] menu AI request failed:', response.status, detail.slice(0, 300));
      return { ok: false, reason: `The model service answered ${response.status}.` };
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { ok: false, reason: 'The model returned nothing.' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(unfence(content));
    } catch {
      return { ok: false, reason: 'The model did not return usable JSON.' };
    }

    const draft = draftFromAiAnswer(parsed);
    if (draft.categories.length === 0) {
      return { ok: false, reason: 'The model found no dishes in that text.' };
    }

    return { ok: true, draft, model: model() };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    console.error('[autodine] menu AI request threw:', error);
    return { ok: false, reason: aborted ? 'The model did not answer in time.' : 'The model could not be reached.' };
  } finally {
    clearTimeout(timeout);
  }
}
