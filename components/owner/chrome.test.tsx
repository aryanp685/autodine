import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Segmented, SwitchTrack, Tag, btn, chipClass, inputClass } from './chrome';
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

  it('stretches to fill when it is the only control on a phone', () => {
    const html = renderToStaticMarkup(
      <Segmented label="Ticket columns" value="new" onChange={() => {}} options={options} fill />,
    );

    // Three equal targets across the width, not three pills at the left edge.
    expect(html).toContain('flex w-full');
    expect((html.match(/flex-1/g) ?? []).length).toBe(2);
  });

  it('keeps every option reachable as a real button', () => {
    const html = renderToStaticMarkup(
      <Segmented label="Voice speed" value="normal" onChange={() => {}} options={options} size="sm" />,
    );

    expect((html.match(/type="button"/g) ?? []).length).toBe(2);
  });
});

/**
 * The 2026-10-24 redesign, pinned as invariants rather than as screenshots.
 *
 * Three things made the old screen read as a developer tool: everything was a
 * pill, every small label was 10-11px upper case, and the accent did three
 * unrelated jobs at once. Each is easy to reintroduce one component at a time,
 * which is exactly why they are asserted here.
 */
describe('the owner kit, after the redesign', () => {
  it('makes actions rectangles, so a pill always means status', () => {
    for (const size of ['sm', 'md'] as const) {
      const cls = btn('solid', size);
      expect(cls).toContain('rounded-[10px]');
      expect(cls).not.toContain('rounded-full');
    }
  });

  it('gives every action the same two heights', () => {
    expect(btn('solid', 'sm')).toContain('h-9');
    expect(btn('solid', 'md')).toContain('h-11');
    // The 8px and 10px steps that produced four heights in one row are gone.
    expect(btn('solid', 'sm')).not.toContain('h-8');
    expect(btn('solid', 'md')).not.toContain('h-10');
  });

  it('gives a field the same 44px geometry as a md action', () => {
    expect(inputClass).toContain('h-11');
    expect(inputClass).toContain('rounded-[10px]');
  });

  it('keeps the pill for status, and never paints status with the accent', () => {
    const live = renderToStaticMarkup(<Tag tone="live">Ready</Tag>);
    expect(live).toContain('rounded-full');
    // Green means settled/ready; copper is position and on-state only.
    expect(live).toContain('--p-live');
    expect(live).not.toContain('--p-accent');

    const work = renderToStaticMarkup(<Tag tone="work">Editing</Tag>);
    expect(work).toContain('--p-accent');
  });

  it('paints a chosen chip with the accent, not with a block of ink', () => {
    // A selected filter is an on-state -- "these rows" -- and copper is what
    // this product uses for position. A solid ink chip was the heaviest thing
    // on the ledger, heavier than the rows it was filtering.
    const on = chipClass(true);
    expect(on).toContain('bg-accent-soft');
    expect(on).not.toContain('bg-gink');

    // Both states carry a border and the same height, so picking a chip does
    // not change the size of the row it sits in.
    expect(chipClass(false)).toContain('border-hair-strong');
    for (const cls of [chipClass(true), chipClass(false)]) {
      expect(cls).toContain('h-9');
      expect(cls).toContain('border ');
    }
  });
});

describe('SwitchTrack', () => {
  it('draws the switch once, so two screens cannot drift by two pixels', () => {
    const on = renderToStaticMarkup(<SwitchTrack on />);
    const off = renderToStaticMarkup(<SwitchTrack on={false} />);

    for (const html of [on, off]) {
      // The one size. The menu editor and the kitchen both use this.
      expect(html).toContain('h-[22px] w-[38px]');
      expect(html).toContain('size-[16px]');
      // The state is announced by the control around it, never by the shape.
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain('<button');
    }

    expect(on).toContain('--p-accent');
    expect(off).toContain('left-[3px]');
    expect(on).toContain('left-[19px]');
  });
});
