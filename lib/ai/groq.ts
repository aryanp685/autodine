/**
 * The second reader: Groq's Llama 4 Scout, when Gemini is having a bad day.
 *
 * WHY THIS MODULE EXISTS
 *
 * The free Gemini tier answers 503 "high demand" for hours at a stretch, and
 * an owner staring at "the reader is busy" cannot import a menu. Groq's free
 * tier is a different provider with a different capacity pool: when Gemini
 * is busy or gone, the same prompt and the same photo go to Llama 4 Scout and
 * the owner never learns there was an outage.
 *
 * WHAT IT GUARANTEES
 *
 * - the same contract as lib/ai/gemini.ts: structured text back, caller-owned
 *   failure sentences, no model names shown to owners;
 * - the same never-guess discipline lives in the CALLERS -- this module only
 *   transports bytes and returns text;
 * - OpenAI-compatible endpoint, so one small request shape and nothing else;
 * - server-only: the key never leaves this process.
 *
 * Free tier reality (2026): ~1,000 requests/day per model, ~6K tokens/min.
 * Enough for imports; if it ever runs out the caller's busy sentence still
 * applies -- the owner is told, not faked around.
 */

import type { GeminiFailureCode, GeminiFailureCopy, GeminiJsonResult } from './gemini';

function groqKey(): string {
  return (process.env.GROQ_API_KEY ?? '').trim();
}

export function groqConfigured(): boolean {
  return groqKey() !== '';
}

/**
 * The fallback vision model. `GROQ_MODEL` overrides without a deploy.
 *
 * Llama 4 Scout because it is the free tier's vision workhorse: images in,
 * JSON out, and Groq runs it fast enough that the owner's wait is dominated
 * by the photo upload, not the model.
 */
export function groqModel(): string {
  return (process.env.GROQ_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct').trim();
}

/**
 * Ask Groq for text over one image and one prompt.
 *
 * Same shape as callGeminiJson so the dispatcher can hand the same args to
 * either reader. `text` is the raw model answer; parsing it is the caller's
 * business.
 */
export async function callGroqJson(
  args: {
    prompt: string;
    bytes: ArrayBuffer;
    mimeType: string;
    maxOutputTokens: number;
    timeoutMs?: number;
    retryDelaysMs?: number[];
    sleep?: (ms: number) => Promise<void>;
  } & GeminiFailureCopy
): Promise<GeminiJsonResult> {
  const key = groqKey();
  if (!key) {
    return { ok: false, code: 'not-configured', reason: args.unreachableReason };
  }

  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelaysMs = args.retryDelaysMs ?? [1500, 3000];

  const base64 = Buffer.from(args.bytes).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 45_000);

  try {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: groqModel(),
          temperature: 0,
          max_tokens: Math.min(args.maxOutputTokens, 8192),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: args.prompt },
                { type: 'image_url', image_url: { url: `data:${args.mimeType};base64,${base64}` } },
              ],
            },
          ],
        }),
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = payload.choices?.[0]?.message?.content ?? '';
        return { ok: true, model: groqModel(), text };
      }

      if (response.status === 429 || response.status === 503) {
        if (attempt < retryDelaysMs.length) {
          await sleep(retryDelaysMs[attempt]);
          continue;
        }
        return { ok: false, code: 'rate-limited', reason: args.busyReason };
      }

      const detail = await response.text().catch(() => '');
      console.error('[autodine] groq call failed:', response.status, detail.slice(0, 300));
      return { ok: false, code: 'upstream', reason: args.unreachableReason };
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    console.error('[autodine] groq call threw:', error);
    return {
      ok: false,
      code: (aborted ? 'timeout' : 'upstream') as GeminiFailureCode,
      reason: aborted ? args.timeoutReason : args.unreachableReason,
    };
  } finally {
    clearTimeout(timeout);
  }
}
