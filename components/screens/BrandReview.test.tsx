import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandReview, brandStateToDraft, type BrandReviewState } from './BrandReview';
import { parseTheme } from '@/lib/branding/theme';

vi.mock('@/app/(staff)/dashboard/menus/brand-actions', () => ({
  extractBrandFromPhotoAction: async () => ({ ok: false, error: 'x', code: 'x' }),
  uploadBrandAssetAction: async () => ({ ok: false, error: 'x' }),
}));

const noop = () => {};

describe('BrandReview', () => {
  it('says plainly that photo reading is off, and keeps the manual path', () => {
    const html = renderToStaticMarkup(
      <BrandReview enabled={false} canWrite existingName="Old Name" file={null} onStateChange={noop} />,
    );
    expect(html).toContain('not switched on');
    expect(html).toContain('Upload logo');
    expect(html).toContain('Primary colour');
  });

  it('never pre-confirms the name', () => {
    const html = renderToStaticMarkup(
      <BrandReview enabled canWrite existingName="Old Name" file={null} onStateChange={noop} />,
    );
    expect(html).toContain('Use this name');
    expect(html).toContain('only applied after you confirm it');
    expect(html).not.toContain('Name confirmed');
  });

  it('offers the read button when a menu photo is already chosen', () => {
    const file = new File(['x'], 'menu.jpg', { type: 'image/jpeg' });
    const html = renderToStaticMarkup(
      <BrandReview enabled canWrite existingName="A" file={file} onStateChange={noop} />,
    );
    expect(html).toContain('Read style from the menu photo');
  });

  it('refuses to run without write access', () => {
    const html = renderToStaticMarkup(
      <BrandReview enabled={false} canWrite={false} existingName="A" file={null} onStateChange={noop} />,
    );
    expect(html).toContain('disabled');
  });
});

describe('brandStateToDraft', () => {
  const state = (over: Partial<BrandReviewState> = {}): BrandReviewState => ({
    name: 'Punjabi Rasoi',
    nameConfirmed: true,
    theme: parseTheme({ colors: { primary: '#7a1f2b' } }),
    logoAssetId: null,
    bannerAssetId: null,
    conflicts: [],
    provenance: { name: 'owner-confirmed' },
    notes: [],
    ...over,
  });

  it('builds a valid draft for the create action', () => {
    const draft = brandStateToDraft(state(), '11111111-2222-4333-8444-555555555555');
    expect(draft).not.toBeNull();
    expect(draft!.nameConfirmed).toBe(true);
    expect(draft!.theme.colors.primary).toBe('#7a1f2b');
  });

  it('returns null when there is no theme at all', () => {
    expect(brandStateToDraft(state({ theme: null }), '11111111-2222-4333-8444-555555555555')).toBeNull();
  });
});
