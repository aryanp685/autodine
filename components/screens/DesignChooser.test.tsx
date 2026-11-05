import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesignChooser } from './DesignChooser';
import { designCandidates } from '@/lib/branding/designs';

const dishes = [
  { category: 'Starters', name: 'Paneer Lababdar', pricePaise: 26900 },
  { category: 'Starters', name: 'Hara Bhara Kebab', pricePaise: 21900 },
  { category: 'Main Course', name: 'Mutton Rogan Josh', pricePaise: 44900 },
  { category: 'Main Course', name: 'Dal Makhani', pricePaise: 21900 },
];

const designs = designCandidates(null);

describe('DesignChooser', () => {
  it('paints both previews with the real guest theme pipeline', () => {
    const html = renderToStaticMarkup(
      <DesignChooser
        designs={designs}
        selectedId={null}
        onSelect={() => {}}
        name="The Courtyard"
        dishes={dishes}
      />
    );

    // Two flow roots, each with the brand attribute the guest CSS keys on.
    expect(html.match(/data-flow-root/g)?.length).toBe(2);
    expect(html.match(/data-brand/g)?.length).toBe(2);
    expect(html).toContain('Warm Classic');
    expect(html).toContain('Fresh Modern');
  });

  it('shows the owner’s real dishes and prices, not sample content', () => {
    const html = renderToStaticMarkup(
      <DesignChooser
        designs={designs}
        selectedId={null}
        onSelect={() => {}}
        name="The Courtyard"
        dishes={dishes}
      />
    );

    expect(html).toContain('Paneer Lababdar');
    expect(html).toContain('Mutton Rogan Josh');
    expect(html).toContain('₹269');
    expect(html).toContain('₹449');
    // Never the marketing mock-up's sample identity or dishes.
    expect(html).not.toContain('Café &amp; Bistro');
    expect(html).not.toContain('Paneer Tikka');
    expect(html).not.toContain('₹249');
  });

  it('marks the picked design and offers the other', () => {
    const html = renderToStaticMarkup(
      <DesignChooser
        designs={designs}
        selectedId="fresh-modern"
        onSelect={() => {}}
        name="The Courtyard"
        dishes={dishes}
      />
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-selected="true"');
  });
});
