import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MenuSlugNeeded } from './MenuSlugNeeded';

/**
 * This screen exists because /menu fell back to a hard-coded demo slug. A
 * configured database answered every bare /menu with a 404 for a venue that is
 * not in it, and a diner who typed the address by hand saw a broken page
 * rather than an explanation.
 */
describe('MenuSlugNeeded', () => {
  const html = renderToStaticMarkup(<MenuSlugNeeded />);

  it('says what to do instead of looking broken', () => {
    expect(html).toContain('Open this menu from your table');
    expect(html).toContain('QR code');
  });

  it('does not show a sample menu, which would read as this restaurant\'s dishes', () => {
    expect(html).not.toContain('Butter Chicken');
    expect(html).not.toContain('Saffron');
  });

  it('points staff at their own dashboard', () => {
    expect(html).toContain('href="/dashboard/menus"');
  });
});
