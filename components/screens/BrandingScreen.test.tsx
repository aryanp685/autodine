import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandingScreen } from './BrandingScreen';
import type { BrandingScreenData } from '@/lib/db/branding-screen';

// The upload actions are server-only modules; the markup is what is tested.
vi.mock('@/app/dashboard/branding/actions', () => ({
  uploadLogoAction: async () => undefined,
  removeLogoAction: async () => undefined,
  uploadBannerAction: async () => undefined,
  removeBannerAction: async () => undefined,
}));

/**
 * Two things this screen got wrong for the person using it.
 *
 * 1. The preview -- the whole point of the page, the real guest header -- sat
 *    in one column of a two-column grid, so half the page beside it was empty
 *    while the thing being previewed was 340px wide.
 * 2. Picking a photo changed nothing on screen: no name, no size, no answer
 *    until the server rejected a 5 MB file. A picker that stays silent reads
 *    as a broken picker.
 */
function data(over: Partial<BrandingScreenData> = {}): BrandingScreenData {
  return {
    name: 'Maddi',
    tagline: 'North Indian, since 1998',
    logoUrl: null,
    bannerUrl: null,
    canEdit: true,
    hasPublishedMenu: true,
    sampleDishes: [],
    ...over,
  } as BrandingScreenData;
}

const render = (d: BrandingScreenData | null) => renderToStaticMarkup(<BrandingScreen data={d} />);

describe('BrandingScreen', () => {
  it('gives the preview the full width of the page', () => {
    const html = render(data());
    expect(html).toContain('lg:col-span-2');
  });

  it('names each picker by the slot it fills', () => {
    const html = render(data());
    expect(html).toContain('data-image-pick="logo"');
    expect(html).toContain('data-image-pick="banner"');
    expect(html).toContain('Choose a logo');
    expect(html).toContain('Choose a banner');
  });

  it('offers replace, not choose, once one is set', () => {
    const html = render(data({ logoUrl: 'https://example.test/l.png' }));
    expect(html).toContain('Replace logo');
    expect(html).not.toContain('Choose a logo');
  });

  it('prints the size limit next to the control, before anything is uploaded', () => {
    const html = render(data());
    expect(html).toContain('up to 2 MB');
    expect(html).toContain('up to 4 MB');
  });

  it('leaves the upload reachable when the bundle never arrives', () => {
    const html = render(data());
    const uploads = html.match(/<button[^>]*>Upload<\/button>/g) ?? [];
    expect(uploads.length).toBe(2);
    for (const button of uploads) expect(button).not.toMatch(/\sdisabled=""/);
  });

  it('disables both pickers for a role that may not edit', () => {
    const html = render(data({ canEdit: false }));
    expect(html).toContain('Read-only for your role');
    const inputs = html.match(/<input[^>]*data-image-pick="[a-z]+"[^>]*>/g) ?? [];
    expect(inputs.length).toBe(2);
    for (const input of inputs) expect(input).toContain('disabled=""');
  });
});
