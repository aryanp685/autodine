import { afterEach, describe, expect, it, vi } from 'vitest';
import { callGeminiJson, callVisionJson, geminiConfigured } from './gemini';

/**
 * These pin the behaviour the two readers now share: busy is retried before
 * it is reported, a retired model falls back once, and every failure keeps
 * the caller's own sentence. The failures here are the ones production has
 * already served us (404 on a retired model, 503 under load).
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
    maxOutputTokens: 1024,
    retryDelaysMs: [1, 1],
    sleep: async () => {},
    ...COPY,
    ...overrides,
  };
}

function okResponse(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
}

function stubKey() {
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  vi.stubEnv('MENU_VISION_API_KEY', '');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('callGeminiJson', () => {
  it('answers on the first call and reports the model that answered', async () => {
    stubKey();
    const fetchMock = vi.fn(async (_input: unknown, _init?: unknown) => okResponse('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiJson(args());

    expect(result).toEqual({ ok: true, model: 'gemini-3.8-flash', text: '{"ok":true}' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('gemini-3.8-flash:generateContent');
  });

  it('retries a 503 before giving up, and reports busy only after the retries', async () => {
    stubKey();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(okResponse('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiJson(args());

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces the caller busy sentence when every 503 retry is exhausted', async () => {
    stubKey();
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiJson(args());

    expect(result).toEqual({ ok: false, code: 'rate-limited', reason: 'busy-sentence' });
    // One attempt plus one per retry delay.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats 429 as busy and retries it too', async () => {
    stubKey();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('quota', { status: 429 }))
      .mockResolvedValueOnce(okResponse('done'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiJson(args({ retryDelaysMs: [1] }));

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to GEMINI_FALLBACK_MODEL when the primary model is gone (404)', async () => {
    stubKey();
    vi.stubEnv('GEMINI_MODEL', 'retired-model');
    vi.stubEnv('GEMINI_FALLBACK_MODEL', 'live-model');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('gone', { status: 404 }))
      .mockResolvedValueOnce(okResponse('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiJson(args());

    expect(result).toEqual({ ok: true, model: 'live-model', text: '{"ok":true}' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('retired-model:generateContent');
    expect(String(fetchMock.mock.calls[1][0])).toContain('live-model:generateContent');
  });

  it('reports the model-missing sentence when the model is gone and no fallback exists', async () => {
    stubKey();
    vi.stubEnv('GEMINI_FALLBACK_MODEL', '');
    const fetchMock = vi.fn(async () => new Response('gone', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiJson(args());

    expect(result).toEqual({ ok: false, code: 'upstream', reason: 'model-missing-sentence' });
  });

  it('does not retry ordinary upstream errors', async () => {
    stubKey();
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiJson(args());

    expect(result).toEqual({ ok: false, code: 'upstream', reason: 'unreachable-sentence' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps a thrown network error to the caller unreachable sentence', async () => {
    stubKey();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));

    const result = await callGeminiJson(args());

    expect(result).toEqual({ ok: false, code: 'upstream', reason: 'unreachable-sentence' });
  });

  it('maps an aborted call to the caller timeout sentence', async () => {
    stubKey();
    vi.stubGlobal('fetch', vi.fn(async () => {
      const aborted = new Error('aborted');
      aborted.name = 'AbortError';
      throw aborted;
    }));

    const result = await callGeminiJson(args());

    expect(result).toEqual({ ok: false, code: 'timeout', reason: 'timeout-sentence' });
  });

  it('refuses to call out without a key', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('MENU_VISION_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiJson(args());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('not-configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is configured when a key variable holds a value and not otherwise', () => {
    vi.stubEnv('GEMINI_API_KEY', 'first');
    expect(geminiConfigured()).toBe(true);

    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('MENU_VISION_API_KEY', '');
    expect(geminiConfigured()).toBe(false);
  });
});

describe('callVisionJson (Gemini first, Groq fallback)', () => {
  /** Routes the mock by host so the dispatcher's two providers are distinct. */
  function stubRoutedFetch(onGemini: () => Promise<Response>, onGroq: () => Promise<Response>) {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      return url.includes('groq.com') ? onGroq() : onGemini();
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function geminiOk(text: string): Response {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  }

  function groqOk(text: string): Response {
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
  }

  it('never touches the fallback when the primary answers', async () => {
    stubKey();
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    const fetchMock = stubRoutedFetch(
      async () => geminiOk('{"ok":true}'),
      async () => groqOk('never'),
    );

    const result = await callVisionJson(args());

    expect(result.ok).toBe(true);
    expect(result.ok && result.model).toBe('gemini-3.8-flash');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to Groq when the primary stays busy after every retry', async () => {
    stubKey();
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    const fetchMock = stubRoutedFetch(
      async () => new Response('busy', { status: 503 }),
      async () => groqOk('{"ok":true}'),
    );

    const result = await callVisionJson(args());

    expect(result).toEqual({ ok: true, model: 'meta-llama/llama-4-scout-17b-16e-instruct', text: '{"ok":true}' });
    // Three Gemini attempts (one + two retries), then one Groq call.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('serves from Groq alone when there is no Gemini key at all', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('MENU_VISION_API_KEY', '');
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    const fetchMock = stubRoutedFetch(
      async () => geminiOk('never'),
      async () => groqOk('{"ok":true}'),
    );

    const result = await callVisionJson(args());

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('groq.com');
  });

  it('reports the caller busy sentence when both providers stay busy', async () => {
    stubKey();
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    stubRoutedFetch(
      async () => new Response('busy', { status: 503 }),
      async () => new Response('busy', { status: 429 }),
    );

    const result = await callVisionJson(args());

    expect(result).toEqual({ ok: false, code: 'rate-limited', reason: 'busy-sentence' });
  });

  it('keeps the primary failure when no fallback key exists', async () => {
    stubKey();
    vi.stubEnv('GROQ_API_KEY', '');
    const fetchMock = stubRoutedFetch(
      async () => new Response('busy', { status: 503 }),
      async () => groqOk('never'),
    );

    const result = await callVisionJson(args());

    expect(result).toEqual({ ok: false, code: 'rate-limited', reason: 'busy-sentence' });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('groq.com');
  });
});
