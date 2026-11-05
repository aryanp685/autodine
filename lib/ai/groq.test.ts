import { afterEach, describe, expect, it, vi } from 'vitest';
import { callGroqJson, groqConfigured } from './groq';

/**
 * The fallback reader's contract: same failure sentences the caller owns,
 * same busy-retry discipline as the primary, and one OpenAI-shaped request
 * with the image inlined as a data URL. What these pin is what a Gemini
 * outage must not change: the owner still gets a read or an actionable
 * sentence.
 */

const COPY = {
  busyReason: 'busy-sentence',
  unreachableReason: 'unreachable-sentence',
  timeoutReason: 'timeout-sentence',
  modelMissingReason: 'model-missing-sentence',
};

function args(overrides: Record<string, unknown> = {}) {
  return {
    prompt: 'p',
    bytes: new ArrayBuffer(8),
    mimeType: 'image/png',
    maxOutputTokens: 4096,
    retryDelaysMs: [1, 1],
    sleep: async () => {},
    ...COPY,
    ...overrides,
  };
}

function okResponse(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('callGroqJson', () => {
  it('sends one OpenAI-shaped request with the image inlined and returns the answer', async () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => okResponse('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGroqJson(args());

    expect(result).toEqual({ ok: true, model: 'meta-llama/llama-4-scout-17b-16e-instruct', text: '{"ok":true}' });
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toContain('/openai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer gsk-test');
    const body = JSON.parse(init.body) as {
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(body.messages[0].content[1].type).toBe('image_url');
    expect(body.messages[0].content[1].image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('retries a 503 before reporting busy', async () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(okResponse('done'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGroqJson(args({ retryDelaysMs: [1] }));

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the caller busy sentence when every retry is exhausted', async () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGroqJson(args());

    expect(result).toEqual({ ok: false, code: 'rate-limited', reason: 'busy-sentence' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maps a thrown network error to the caller unreachable sentence', async () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const result = await callGroqJson(args());

    expect(result).toEqual({ ok: false, code: 'upstream', reason: 'unreachable-sentence' });
  });

  it('refuses to call out without a key', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGroqJson(args());

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('knows when it is configured', () => {
    vi.stubEnv('GROQ_API_KEY', '');
    expect(groqConfigured()).toBe(false);
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    expect(groqConfigured()).toBe(true);
  });
});
