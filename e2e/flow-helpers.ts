import { type Page } from '@playwright/test';

/**
 * WAIT FOR THE PAGE TO BE A REACT PAGE BEFORE CLICKING ANYTHING ON IT.
 *
 * The shell suite learned this the hard way (see waitForHydration in
 * shell.ts): Next.js serves real HTML first and attaches the behaviour
 * seconds later. A click that lands in between goes to a button that does
 * nothing yet -- it is not flaky, it is early. Every spec that clicks or
 * reads state React derives from localStorage waits here first.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      for (const el of document.querySelectorAll('a, button, input, textarea, label')) {
        for (const key of Object.keys(el)) {
          if (key.startsWith('__reactProps') || key.startsWith('__reactFiber')) return true;
        }
      }
      return false;
    },
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * Shared helpers for the browser-level restaurant-workflow tests.
 *
 * DEMO MODE (the default for `playwright.config.ts`)
 *
 * The app is started with no Supabase environment, which is a supported
 * state: every screen renders its own sample content, and any action that
 * would write to a database fails honestly ("Ordering is not available right
 * now.", "Nothing was recorded and no money changed hands."). These helpers
 * never fake success — they drive the real UI and assert what it really does.
 *
 * FIXTURES ARE THE PRODUCT'S OWN SAMPLE DATA
 *
 * The sample menu (lib/demo-data.ts), the sample kitchen board and the sample
 * counter queue are the fixtures. Nothing is seeded into a database because
 * there is no database: the disposable environment is the throwaway
 * `next start` on port 3100, and its localStorage is per-test.
 */

/** The demo cart key: cartKey('demo') = 'autodine.cart.' + 'demo'. */
export const DEMO_CART_KEY = 'autodine.cart.demo';

/** Seed the guest's localStorage cart before any page script runs. */
export async function seedCart(page: Page, lines: unknown[]): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value as string);
    },
    [DEMO_CART_KEY, JSON.stringify(lines)] as const,
  );
}

/**
 * Install a recording stub for the kitchen voice.
 *
 * WHY A STUB AND NOT THE REAL THING
 *
 * The dual engine tries the server TTS route first and falls back to the
 * browser Web Speech API. A headless Chromium has `speechSynthesis` but no
 * voices and no audio device, so a real run would decide "no Hindi voice" and
 * never announce anything — a green test proving nothing. This stub:
 *
 *   1. fails `/api/tts` on purpose, so the engine deterministically falls
 *      back to the browser path;
 *   2. replaces `speechSynthesis` with a recorder that reports one hi-IN
 *      voice (so `available()` is true) and fires `onstart`/`onend`;
 *   3. appends every utterance text to `window.__spoken`.
 *
 * Assertions are counts of announcement attempts — exactly the contract
 * "the same order is never announced twice". The words themselves are unit
 * tested in lib/announce.test.ts / lib/hindi.test.ts / lib/english.test.ts.
 */
export async function recordAnnouncements(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;

    class FakeUtterance {
      text: string;
      voice: unknown = null;
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event?: { error?: string }) => void) | null = null;
      constructor(text = '') {
        this.text = text;
      }
    }

    const synthesis = {
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      getVoices: () => [
        { name: 'Madhur (Hindi)', lang: 'hi-IN', localService: true, default: true },
        { name: 'Google US English', lang: 'en-US', localService: false, default: false },
      ],
      speak(utterance: { text?: string; onstart?: (() => void) | null; onend?: (() => void) | null }) {
        spoken.push(String(utterance?.text ?? ''));
        synthesis.speaking = true;
        setTimeout(() => {
          synthesis.speaking = false;
          utterance?.onstart?.();
          utterance?.onend?.();
        }, 5);
      },
      cancel() {
        synthesis.speaking = false;
      },
      pause() {},
      resume() {},
      addEventListener() {},
      removeEventListener() {},
    };

    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      FakeUtterance;
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = synthesis;
  });

  // Deterministic fallback: the server engine must fail so the stub is used.
  await page.route('**/api/tts', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"disabled under test"}',
    }),
  );
}

/** How many announcement attempts this page load has made. */
export async function announcementCount(page: Page): Promise<number> {
  return page.evaluate(
    () => ((window as unknown as { __spoken?: string[] }).__spoken ?? []).length,
  );
}

/** Parse "₹1,247" into 1247. */
export function rupees(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : NaN;
}
