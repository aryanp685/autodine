import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranslationPanel, rowNeedsWork, type TranslateRowModel } from './TranslationPanel';
import { sourceHash } from '@/lib/i18n/translations';

const row = (over: Partial<TranslateRowModel> = {}): TranslateRowModel => ({
  kind: 'item',
  id: 'i-1',
  name: 'Paneer Tikka',
  description: 'Cottage cheese on skewers.',
  translations: {},
  ...over,
});

describe('TranslationPanel', () => {
  it('shows the original beside an empty proposal, with both languages offered', () => {
    const html = renderToStaticMarkup(<TranslationPanel rows={[row()]} />);

    expect(html).toContain('Paneer Tikka');
    expect(html).toContain('Cottage cheese on skewers.');
    expect(html).toContain('हिन्दी');
    expect(html).toContain('मराठी');
    expect(html).toContain('Generate with AI');
    // Nothing saves before the owner accepts anything.
    expect(html).toContain('Save 0 accepted');
    expect(html).toContain('aria-label="Translated name for Paneer Tikka"');
    expect(html).toContain('aria-label="Translated description for Paneer Tikka"');
  });

  it('marks a current translation and asks for nothing there', () => {
    const fresh = row({
      translations: {
        hi: {
          name: 'पनीर टिक्का',
          description: 'स्क्यूअर पर ग्रील्ड पनीर।',
          approved: true,
          sourceHash: sourceHash('Paneer Tikka', 'Cottage cheese on skewers.'),
        },
      },
    });

    const html = renderToStaticMarkup(<TranslationPanel rows={[fresh]} />);

    expect(html).toContain('Current translation');
    expect(html).toContain('Nothing left to translate.');
  });

  it('labels categories as categories so rows stay readable', () => {
    const html = renderToStaticMarkup(<TranslationPanel rows={[row({ kind: 'category', description: '' })]} />);

    expect(html).toContain('Category');
    expect(html).toContain('1 row needs translation.');
  });
});

describe('rowNeedsWork', () => {
  it('is the freshness rule the generate button obeys', () => {
    const fresh = row({
      translations: {
        hi: {
          name: 'पनीर टिक्का',
          description: '',
          approved: true,
          sourceHash: sourceHash('Paneer Tikka', 'Cottage cheese on skewers.'),
        },
      },
    });

    expect(rowNeedsWork(row(), 'hi')).toBe(true);
    expect(rowNeedsWork(fresh, 'hi')).toBe(false);
    expect(rowNeedsWork(fresh, 'mr')).toBe(true);
    // A changed dish makes its translation stale again.
    expect(rowNeedsWork({ ...fresh, description: 'NEW' }, 'hi')).toBe(true);
  });
});
