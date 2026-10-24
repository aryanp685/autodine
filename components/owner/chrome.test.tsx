import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Segmented } from './chrome';
import { PageMotion } from './PageMotion';

/**
 * The two pieces added for the dashboard redesign pass.
 *
 * These are markup tests on purpose. The behaviour that matters most here is
 * not the animation or the click -- it is what the SERVER sends, because that
 * is what a browser with no JavaScript, a blocked bundle or a failed hydration
 * is left holding.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => '/dashboard',
}));

describe('PageMotion', () => {
  it('sends its final state from the server', () => {
    const html = renderToStaticMarkup(
      <PageMotion>
        <p>Revenue today</p>
      </PageMotion>,
    );

    // The content is present, and nothing has hidden it: an entrance animation
    // that starts at opacity 0 in the markup is a blank page whenever the
    // client never arrives.
    expect(html).toContain('Revenue today');
    expect(html).not.toContain('opacity:0');
    expect(html).not.toContain('translateY');
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'photo', label: 'Photo of your menu' },
    { value: 'text', label: 'Paste the text' },
  ] as const;

  it('marks exactly one choice and names the group', () => {
    const html = renderToStaticMarkup(
      <Segmented label="How to import" value="text" onChange={() => {}} options={options} />,
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="How to import"');
    // Two buttons, one pressed.
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-pressed="true"');
  });

  it('is not announced as a tab strip it cannot back up', () => {
    const html = renderToStaticMarkup(
      <Segmented label="How to import" value="photo" onChange={() => {}} options={options} />,
    );

    // A tablist needs tabpanels, aria-controls and roving arrow keys. This is a
    // group of toggle buttons switching content it does not own.
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('aria-selected');
  });

  it('keeps every option reachable as a real button', () => {
    const html = renderToStaticMarkup(
      <Segmented label="Voice speed" value="normal" onChange={() => {}} options={options} size="sm" />,
    );

    expect((html.match(/type="button"/g) ?? []).length).toBe(2);
  });
});
