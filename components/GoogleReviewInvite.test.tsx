// @vitest-environment jsdom
/**
 * The review invitation's behaviour, in a real DOM.
 *
 * renderToStaticMarkup cannot check this component: the sheet opens from an
 * effect after hydration. These tests mount it for real, and pin the three
 * behaviours the product committed to:
 *  - the invitation opens with THIS restaurant's destination, not a search;
 *  - the destination is identical whatever star the guest taps (fairness:
 *    the stars are a gesture, never a gate);
 *  - a dismissed invitation stays dismissed across re-renders and polls.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GoogleReviewInvite } from './GoogleReviewInvite';

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const REVIEW_URL = 'https://g.page/r/AbCdEf12345/review';

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <GoogleReviewInvite orderId={ORDER_ID} restaurantName="Spice Route" reviewUrl={REVIEW_URL} />,
    );
  });
  const entry = { root, container };
  mounted.push(entry);
  return {
    root,
    unmount() {
      act(() => root.unmount());
      container.remove();
      mounted.splice(mounted.indexOf(entry), 1);
    },
  };
}

async function settle(root: Root) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  void root;
}

function dialog() {
  return document.querySelector('[role="dialog"]');
}

function reviewLink() {
  return document.querySelector<HTMLAnchorElement>('a[href]');
}

beforeEach(() => {
  while (mounted.length) {
    const entry = mounted.pop()!;
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  window.localStorage.clear();
  // jsdom has no matchMedia; framer-motion's useReducedMotion asks for it.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe('GoogleReviewInvite', () => {
  it('opens with this restaurant\u2019s own Google destination', async () => {
    const { root } = mount();
    await settle(root);
    expect(dialog()).not.toBeNull();
    expect(document.body.textContent).toContain('Spice Route');
    // The honesty line: the tap here does not transfer to Google's form.
    expect(document.body.textContent).toMatch(/choose your stars again/i);
    expect(reviewLink()?.getAttribute('href')).toBe(REVIEW_URL);
    expect(reviewLink()?.getAttribute('target')).toBe('_blank');
  });

  it('opens the same page whatever star the guest taps', async () => {
    const { root } = mount();
    await settle(root);
    const stars = [...(dialog()?.querySelectorAll<HTMLButtonElement>('[role="group"] button') ?? [])];
    expect(stars.length).toBe(5);

    act(() => {
      stars[0]?.click(); // a one-star visit
    });
    await settle(root);
    const afterOneStar = reviewLink()?.getAttribute('href');
    expect(afterOneStar).toBe(REVIEW_URL);

    act(() => {
      stars[4]?.click(); // a five-star visit
    });
    await settle(root);
    expect(reviewLink()?.getAttribute('href')).toBe(afterOneStar);
  });

  it('stays dismissed across re-renders and re-mounts', async () => {
    const first = mount();
    await settle(first.root);
    const close = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (button) => button.getAttribute('aria-label') === 'Close',
    );
    act(() => {
      close?.click();
    });
    await settle(first.root);
    expect(window.localStorage.getItem(`autodine-review-invite-done:${ORDER_ID}`)).toBe('1');
    first.unmount();

    const second = mount();
    await settle(second.root);
    expect(dialog()).toBeNull();
    second.unmount();
  });
});
