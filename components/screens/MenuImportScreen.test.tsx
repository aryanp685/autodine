import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MenuImportScreen } from './MenuImportScreen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => '/dashboard/menus/import',
}));

vi.mock('@/app/(staff)/dashboard/menus/import-actions', () => ({
  createImportedMenuAction: async () => ({ ok: false }),
  previewMenuImportAction: async () => ({ ok: false }),
}));

vi.mock('@/components/PhotoImportPanel', () => ({
  PhotoImportPanel: () => <div data-photo-panel>photo reader</div>,
}));

/**
 * A path that cannot succeed is not an option.
 *
 * The import screen used to open on "Photo of your menu" whether or not the
 * deployment could read a photograph. On a server with no vision key that tab
 * could only ever fail, and it was the first thing an owner was shown. The tab
 * is now gated on the key, and the text pasting path -- which always works --
 * is what the screen offers.
 */
describe('Menu import with no vision key', () => {
  it('does not offer the photo path', () => {
    const html = renderToStaticMarkup(<MenuImportScreen visionEnabled={false} />);

    expect(html).not.toContain('Photo of your menu');
    expect(html).not.toContain('data-photo-panel');
  });

  it('says why, and points at the path that works', () => {
    const html = renderToStaticMarkup(<MenuImportScreen visionEnabled={false} />);

    expect(html).toContain('Paste the text');
    expect(html).toContain('does not have one');
  });
});

describe('Menu import with a vision key', () => {
  it('offers both inputs', () => {
    const html = renderToStaticMarkup(<MenuImportScreen visionEnabled />);

    expect(html).toContain('Photo of your menu');
    expect(html).toContain('Paste the text');
    expect(html).toContain('data-photo-panel');
  });
});
