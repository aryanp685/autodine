import { afterEach, describe, expect, it, vi } from 'vitest';
import { callGeminiJson, geminiConfigured } from './gemini';

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
