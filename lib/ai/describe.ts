/**
 * Writing dish descriptions — one engine, two doors.
 *
 * WHY THIS EXISTS AT ALL
 *
 * A menu of names and prices is a list; a menu of dishes is a menu. Most
 * owners never get around to writing descriptions — twenty dishes, twenty
 * blank fields, and no owner with an evening to spare. This engine reads
 * what the owner already wrote (the dish's name and its section) and writes
 * the short description they would have written themselves.
 *
 * WHAT IS DELIBERATELY NOT HAPPENING HERE
 *
 * It invents nothing. No ingredients the name does not say, no preparation,
 * no origin story, no price, no marketing. A name it cannot honestly
 * describe comes back as a per-dish failure, because a wrong description on
 * a live menu is worse than a blank one. The same rule the photo reader
 * holds: what the source does not say, AutoDine does not say on its behalf.
 *
 * Both the per-dish "Write with AI" button and the bulk "Enhance menu"
 * review call THIS — one engine, no second system to keep honest.
 */

import { callTextJson, geminiConfigured } from './gemini';
import { groqConfigured } from './groq';

/** One dish awaiting a description. */
export type DescribeTarget = {
  id: string;
  name: string;
  /** The dish's section, as light context — never a source of claims. */
  category: string;
};

export type DescribeResult =
  | { id: string; ok: true; description: string }
  | { id: string; ok: false; reason: string };

/** The editor's description column has no cap; this is the one every writer agrees on. */
export const MAX_DESCRIPTION_LENGTH = 300;

/** Per model call. Small enough to stay inside one answer, large enough to be one round trip. */
const CHUNK = 10;

export function describeConfigured(): boolean {
  return geminiConfigured() || groqConfigured();
}

/** Strip the ```json fences some models wrap answers in. */
function unfence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return fenced ? fenced[1] : text;
}

const RULES = [
  'You write one short sentence of description for each dish on a restaurant menu.',
  'Rules for every description:',
  '- Use ONLY what the dish name and its section say. Never invent ingredients, preparation, origin, or style the name does not state.',
  '- No prices, no superlatives, no marketing words like "delicious" or "best". Plain, honest, specific.',
  '- At most 150 characters, one sentence.',
  '- Write in the same language and script as the dish name (Hindi name -> Hindi description, English name -> English description).',
  '- If a name is too unclear or too little to describe honestly, use null for that dish instead of guessing.',
].join('\n');

function buildPrompt(targets: readonly DescribeTarget[]): string {
  const lines = targets.map(
    (target, index) =>
      `${index + 1}. ${target.name}${target.category ? ` (section: ${target.category})` : ''}`
  );
  return `${RULES}\n\nDishes:\n${lines.join('\n')}\n\nReply with JSON only, in this exact shape:\n{"items": ["description one", null, "description three"]}\nThe "items" array must have exactly ${targets.length} entries, in the same order as the dishes. Use a string or null per dish.`;
}

/** Strip whitespace and hold every writer to the same cap. */
function cleanDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_LENGTH);
}

/**
 * Generate a description per dish. Per-dish results — never a batch
 * verdict: the bulk review must be able to show exactly which dishes were
 * written and which were not, and why.
 */
export async function generateDescriptions(
  targets: readonly DescribeTarget[]
): Promise<DescribeResult[]> {
  if (targets.length === 0) return [];

  if (!describeConfigured()) {
    return targets.map((target) => ({
      id: target.id,
      ok: false as const,
      reason: 'Writing is not switched on for this deployment.',
    }));
  }

  const results: DescribeResult[] = [];

  for (let start = 0; start < targets.length; start += CHUNK) {
    const chunk = targets.slice(start, start + CHUNK);

    const result = await callTextJson({
      prompt: buildPrompt(chunk),
      maxOutputTokens: 2048,
      busyReason: 'The writer is busy right now. Wait a minute and try again.',
      unreachableReason: 'The writer could not be reached. Your dishes are unchanged.',
      timeoutReason: 'That took too long. Try again — your dishes are unchanged.',
      modelMissingReason: 'The writer is not available on this deployment right now.',
    });

    if (!result.ok) {
      for (const target of chunk) results.push({ id: target.id, ok: false, reason: result.reason });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(unfence(result.text));
    } catch {
      console.error('[autodine] description writer returned non-JSON:', result.text.slice(0, 200));
      for (const target of chunk) {
        results.push({ id: target.id, ok: false, reason: 'The writer returned something unreadable. Try again.' });
      }
      continue;
    }

    const items = (parsed as { items?: unknown })?.items;
    const answers = Array.isArray(items) ? items : [];

    chunk.forEach((target, index) => {
      const answer = answers[index];
      if (typeof answer !== 'string') {
        results.push({
          id: target.id,
          ok: false,
          reason: 'The writer had nothing honest to say for this one. Write it by hand.',
        });
        return;
      }
      const description = cleanDescription(answer);
      if (description === '') {
        results.push({ id: target.id, ok: false, reason: 'The writer returned an empty line. Try again.' });
        return;
      }
      results.push({ id: target.id, ok: true, description });
    });
  }

  return results;
}
