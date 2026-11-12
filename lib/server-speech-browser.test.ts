import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserServerSpeechEnv } from './server-speech-browser';

describe('browserServerSpeechEnv', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the selected Edge voice and prosody to the TTS endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = browserServerSpeechEnv(vi.fn());
    const request = {
      text: 'नया ऑर्डर।',
      voice: 'hi-IN-MadhurNeural',
      rate: '-8%',
      pitch: '-4Hz',
    };
    const audio = await env.fetchTTS(request);

    expect(fetchMock).toHaveBeenCalledWith('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    expect(audio.byteLength).toBe(8);
  });
});
