import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MenuImportScreen } from './MenuImportScreen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => '/dashboard/menus/import',
}));

vi.mock('@/app/(staff)/dashboard/menus/import-actions', () => ({
  attachImportPhotosAction: async () => ({ ok: true, attached: 0, skipped: 0, skippedNames: [] }),
}));

vi.mock('@/app/(staff)/dashboard/menus/brand-actions', () => ({
  createImportPairAction: async () => ({ ok: false }),
  extractBrandFromPhotoAction: async () => ({ ok: false }),
  uploadBrandAssetAction: async () => ({ ok: false }),
}));

vi.mock('@/components/screens/BrandReview', () => ({
  BrandReview: (props: { enabled: boolean }) => (
    <div data-brand-review={props.enabled ? 'enabled' : 'manual'}>brand review</div>
  ),
  brandStateToDraft: () => null,
}));

vi.mock('@/components/PhotoImportPanel', () => ({
  PhotoImportPanel: () => <div data-photo-panel>photo reader</div>,
}));

/**
 * The photo reader is optional; deterministic text import remains available
 * without a vision key, and both routes lead into the same checked draft.
 */
describe('Menu import with no vision key', () => {
  it('does not offer the photo path', () => {
    const html = renderToStaticMarkup(<MenuImportScreen visionEnabled={false} />);

    expect(html).not.toContain('data-photo-panel');
  });

  it('offers the deterministic text path when photo reading is unavailable', () => {
    const html = renderToStaticMarkup(<MenuImportScreen visionEnabled={false} />);

    expect(html).toContain('Paste a menu');
    expect(html).toContain('Menu text');
    expect(html).toContain('Read the menu');
  });
});

describe('Menu import with a vision key', () => {
  it('offers both the photo reader and the no-AI text path', () => {
    const html = renderToStaticMarkup(<MenuImportScreen visionEnabled />);

    expect(html).toContain('data-photo-panel');
    expect(html).toContain('Paste a menu');
    expect(html).not.toContain('Spreadsheet');
  });

  it('keeps the brand review and the progress strip on the same journey', () => {
    const html = renderToStaticMarkup(<MenuImportScreen visionEnabled />);

    expect(html).toContain('data-brand-review');
    expect(html).toContain('data-import-steps');
  });
});

describe('the journey frame', () => {
  it('shows the hero, four steps, and labels the storefront mock-up as a sample', () => {
    const html = renderToStaticMarkup(<MenuImportScreen visionEnabled />);

    expect(html).toContain('Branded Storefront');
    expect(html).toContain('Add Menu');
    expect(html).toContain('Choose Design');
    expect(html).toContain('Publish');
    // The design step is next on the build: it renders dashed and quiet,
    // never as a step the owner can be sent down.
    expect(html).toContain('data-step="upcoming"');
    expect(html).toContain('Sample preview');
    expect(html).toContain('Get 2 Design Options');
  });

  it('shows no design chooser before there is a draft to preview', () => {
    const html = renderToStaticMarkup(<MenuImportScreen visionEnabled />);

    expect(html).not.toContain('data-design-chooser');
  });
});
