// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WelcomeSplash } from './WelcomeSplash';

/**
 * The post-signup welcome.
 *
 * WHAT THIS GUARDS
 *
 * The splash is an overlay, not a page: it must announce itself as a modal,
 * name the two beats, and always offer a way out. It also must not run its
 * timers forever in a background tab, which is why the phase transition is
 * asserted here rather than left to the browser.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('welcome splash', () => {
  it('announces the setting beat, moves to the ready beat and closes on the button', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(<WelcomeSplash open onClose={onClose} />);
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(container.textContent).toContain('Setting your table…');

    await act(async () => {
      vi.advanceTimersByTime(2600);
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(container.textContent).toContain('Your table is set.');

    const button = [...container.querySelectorAll('button')].find((candidate) =>
      /continue to your inbox|skip the welcome/i.test(candidate.textContent ?? ''),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
