/**
 * Browser environment for the server-backed kitchen voice.
 *
 * Wires the server speech engine (lib/server-speech.ts) to real browser
 * APIs: fetch for the /api/tts relay, Audio element for playback,
 * Blob URLs for audio data. Mirrors browserSpeechEnv() in lib/speech.ts
 * but for the server engine instead of the Web Speech API.
 */

import type { ServerSpeechEnv } from './server-speech';

/**
 * Create a ServerSpeechEnv using real browser APIs.
 *
 * The chime is shared with the browser engine — the same two-tone
 * WebAudio chime plays before either engine speaks.
 */
export function browserServerSpeechEnv(chime: () => void): ServerSpeechEnv {
  return {
    chime,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    createAudio: (url) => {
      // Use a real HTMLAudioElement. The cast is needed because the
      // minimal interface above is a subset of HTMLAudioElement.
      const audio = new Audio(url);
      return audio as unknown as ReturnType<ServerSpeechEnv['createAudio']>;
    },
    createObjectUrl: (data) => URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' })),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    fetchTTS: async ({ text, voice, rate, pitch }) => {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, rate, pitch }),
      });
      if (!response.ok) {
        throw new Error(`TTS relay returned ${response.status}`);
      }
      return response.arrayBuffer();
    },
  };
}
