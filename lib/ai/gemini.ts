/**
 * The one place that talks to Gemini.
 *
 * WHY THIS MODULE EXISTS
 *
 * menu-vision and brand-vision each carried their own copy of the same fetch:
 * same key lookup, same request shape, same 45-second patience. Two copies
 * meant two places to learn the same lesson twice. When Google stopped
 * serving `gemini-2.5-flash` to new keys (404 "no longer available to new
 * users") and when the free tier answered 503 under load, both readers failed
 * with one misleading sentence -- "The reader could not be reached" -- and
 * neither retried, so a temporary overload looked like a broken feature.
 *
 * WHAT THIS GUARANTEES
 *
 * - one documented request shape (inline_data, JSON responseMimeType,
 *   temperature 0);
 * - busy is retried before it is reported: 429 and 503 get two more tries
 *   with backoff, inside the same overall patience budget;
 * - a 404 on the primary model falls back to GEMINI_FALLBACK_MODEL once --
 *   how a deployment survives a model Google has retired, without a deploy;
 * - failures come back as a code plus a sentence the CALLER supplies, because
 *   the two readers offer different manual fallbacks ("add dishes by hand"
 *   vs "set your logo and colour by hand"). Owners get actions, never stack
 *   traces or model names.
 *
 * Server-only: the key never leaves this process.
 */

/** The failure codes shared by both readers. */
export type GeminiFailureCode = 'not-configured' | 'rate-limited' | 'timeout' | 'upstream';

export type GeminiJsonResult =
  | { ok: true; model: string; text: string }
  | { ok: false; code: GeminiFailureCode; reason: string };

/** Sentences the caller owns, because the manual fallback differs per reader. */
export type GeminiFailureCopy = {
  /** Shown when the service stays busy after every retry. */
  busyReason: string;
  /** Shown when the service errors or the network fails. */
  unreachableReason: string;
  /** Shown when the whole patience budget expires. */
  timeoutReason: string;
  /** Shown when the model itself is gone and no fallback is configured. */
  modelMissingReason: string;
};

function apiKey(): string {
  return (process.env.GEMINI_API_KEY ?? process.env.MENU_VISION_API_KEY ?? '').trim();
}

export function geminiConfigured(): boolean {
  return apiKey() !== '';
}

/**
 * The model both readers ask for first.
 *
 * `GEMINI_MODEL` overrides without a deploy. The default is 3.8-flash because
 * Google stopped serving `gemini-2.5-flash` to accounts created after the
 * 2026 hand-off: it still lists in `models`, it still 404s on generateContent,
 * and "The reader could not be reached" is the worst possible way to say so.
 */
export function primaryModel(): string {
  return (process.env.GEMINI_MODEL ?? 'gemini-3.8-flash').trim();
}

/**
 * A second model tried ONLY when the first is gone (404), never when it is
 * busy -- busy means the model exists and the fallback would be busy too.
 * Empty (the default) means no fallback.
 */
function fallbackModel(): string {
  return (process.env.GEMINI_FALLBACK_MODEL ?? '').trim();
}

const GENERATE_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

/**
 * Ask Gemini for JSON over one image (or PDF pages) and one prompt.
 *
 * `text` is the joined candidate text; parsing it into a draft is the
 * caller's business -- the two readers want different shapes and keep their
 * own never-guess rules there.
 */
export async function callGeminiJson(
  args: {
    prompt: string;
    bytes: ArrayBuffer;
    mimeType: string;
    maxOutputTokens: number;
    /** Overall patience, retries included. Default 45s. */
    timeoutMs?: number;
    /** Backoff between busy retries. Injectable for tests. */
    retryDelaysMs?: number[];
    /** Injectable for tests. */
    sleep?: (ms: number) => Promise<void>;
  } & GeminiFailureCopy
): Promise<GeminiJsonResult> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      code: 'not-configured',
      reason: 'Reading is not switched on for this deployment.',
    };
  }

  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelaysMs = args.retryDelaysMs ?? [1500, 3000];

  const base64 = Buffer.from(args.bytes).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 45_000);

  const candidates = [primaryModel()];
  const fallback = fallbackModel();
  if (fallback && fallback !== candidates[0]) candidates.push(fallback);

  try {
    for (let m = 0; m < candidates.length; m += 1) {
      const model = candidates[m];
      const isLastModel = m === candidates.length - 1;

      for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(GENERATE_URL(model), {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: args.prompt }, { inline_data: { mime_type: args.mimeType, data: base64 } }],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              maxOutputTokens: args.maxOutputTokens,
            },
          }),
        });

        if (response.ok) {
          const payload = (await response.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
          return { ok: true, model, text };
        }

        // Busy is temporary by definition: retry it before telling the owner
        // anything. 429 is quota, 503 is capacity -- same human sentence.
        if (response.status === 429 || response.status === 503) {
          if (attempt < retryDelaysMs.length) {
            await sleep(retryDelaysMs[attempt]);
            continue;
          }
          return { ok: false, code: 'rate-limited', reason: args.busyReason };
        }

        // The model is gone. The next candidate (if any) gets a clean try;
        // this is the error class that once cost an afternoon.
        if (response.status === 404 && !isLastModel) break;

        const detail = await response.text().catch(() => '');
        console.error('[autodine] gemini call failed:', model, response.status, detail.slice(0, 300));
        if (response.status === 404) {
          return { ok: false, code: 'upstream', reason: args.modelMissingReason };
        }
        return { ok: false, code: 'upstream', reason: args.unreachableReason };
      }
    }
    // Unreachable: the loop either returns or breaks into the next model.
    return { ok: false, code: 'upstream', reason: args.unreachableReason };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    console.error('[autodine] gemini call threw:', error);
    return {
      ok: false,
      code: aborted ? 'timeout' : 'upstream',
      reason: aborted ? args.timeoutReason : args.unreachableReason,
    };
  } finally {
    clearTimeout(timeout);
  }
}
