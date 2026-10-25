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
  it('keeps the preview out of the two-column asset grid', () => {
    // It used to be a `lg:col-span-2` child of that grid, so half the row beside
    // it was empty while the thing being previewed was 340px wide. It is a
    // section after the grid now, at the page's own width.
    const html = render(data());
    const gridAt = html.indexOf('<div class="grid gap-4 lg:grid-cols-2');
    expect(gridAt).toBeGreaterThan(-1);

    // Where that grid closes, by matching its own div tags.
    let depth = 0;
    let closesAt = -1;
    const re = /<div\b|<\/div>/g;
    re.lastIndex = gridAt;
    for (let m = re.exec(html); m; m = re.exec(html)) {
      depth += m[0] === '</div>' ? -1 : 1;
      if (depth === 0) {
        closesAt = m.index;
        break;
      }
    }

    expect(closesAt).toBeGreaterThan(gridAt);
    expect(html.indexOf('aria-labelledby="branding-preview"')).toBeGreaterThan(closesAt);
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
    const uploads = html.match(/<button[^>]*>Upload (?:logo|banner)<\/button>/g) ?? [];
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

/**
 * THE REDESIGN, AND WHAT IT WAS HIDING
 *
 * Three of these guard things that looked perfectly fine on screen: a control
 * that was a status pill, two buttons with the same name that write different
 * things, and a copper "+" that is the guest menu's real add button rendered
 * where nothing can be tapped.
 */
describe('Branding, the redesign', () => {
  it('reaches the real guest menu, not only an in-app preview', () => {
    // `slug` was loaded by the data loader and never used, so the page promised
    // "this is what they see" with no way to get to what they see.
    const html = render(data({ slug: 'maddi' } as Partial<BrandingScreenData>));

    expect(html).toContain('href="/menu?s=maddi"');
    expect(html).toContain('Open guest menu');
  });

  it('offers no guest-menu link when there is no restaurant to open', () => {
    const html = render(data({ slug: '' } as Partial<BrandingScreenData>));
    expect(html).not.toContain('href="/menu?s=');
  });

  it('gives the two uploads two different names', () => {
    // Two buttons called "Upload" write two different things: identical names
    // to a screen reader, to voice control, and to anyone skimming.
    const html = render(data());
    expect(html).toContain('>Upload logo<');
    expect(html).toContain('>Upload banner<');
    expect(html).not.toContain('>Upload<');
  });

  it('dresses the picker as a control, not as a status pill', () => {
    const html = render(data());
    const picker = html.slice(html.indexOf('data-image-pick="logo"') - 400);

    // The label is the kit's diameter and radius; `h-8 rounded-full` was a chip
    // sitting beside a 36px rectangular button on the same line.
    expect(picker).toContain('h-9');
    // The 10px step is the shared control token now: one radius scale for
    // actions, fields and pickers instead of a literal per file.
    expect(picker).toContain('rounded-[var(--p-r-control)]');
    expect(picker).not.toContain('rounded-full border border-hair-strong');
  });

  it('marks the sample dish row as inert, because it is not tappable', () => {
    const html = render(
      data({
        sampleDishes: [{ id: 'd1', name: 'Butter Chicken', price: 42_000, img: null }],
      } as Partial<BrandingScreenData>),
    );
    const at = html.indexOf('pointer-events-none select-none');
    // React writes `aria-hidden` before `class`, so the whole opening tag is the
    // slice to inspect.
    const row = html.slice(Math.max(0, html.lastIndexOf('<div', at)), at + 400);

    expect(row).toContain('aria-hidden="true"');
    expect(row).toContain('Butter Chicken');
    // ...and the page says so once, in words.
    expect(html).toContain('are not tappable here');
  });

  it('draws no hand-made callouts any more', () => {
    const html = render(data({ canEdit: false }));
    expect(html).not.toContain('bg-[var(--alert)]/8');
    expect(html).toContain('Read-only for your role');
  });

  it('sends the owner to Settings for the name, which is not editable here', () => {
    const html = render(data());
    expect(html).toContain('href="/dashboard/settings"');
    expect(html).toContain('Name and tagline live in');
  });

  it('points at Menus when nothing is published, instead of a dead end', () => {
    const html = render(data({ hasPublishedMenu: false } as Partial<BrandingScreenData>));
    expect(html).toContain('Nothing is published yet.');
    expect(html).toContain('href="/dashboard/menus"');
  });
});
