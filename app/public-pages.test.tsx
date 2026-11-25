import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FeaturesPage from './features/page';
import HowItWorksPage from './how-it-works/page';
import ScreensPage from './screens/page';
import TrustPage from './trust/page';

const pages = [
  { route: '/features', render: FeaturesPage },
  { route: '/how-it-works', render: HowItWorksPage },
  { route: '/screens', render: ScreensPage },
  { route: '/trust', render: TrustPage },
];

describe('public marketing routes', () => {
  for (const page of pages) {
    it(`${page.route} renders a named screen with working next steps`, () => {
      const markup = renderToStaticMarkup(page.render());
      expect(markup).toContain('class="public-landing');
      expect(markup).toContain(`aria-current="page"`);
      expect(markup).toContain('href="/signup"');
      expect(markup).toContain('Start your trial');
      expect(markup).toContain('data-reveal');
      expect(markup).toContain('data-public-intro');
      expect(markup).toContain('href="/pricing"');
      expect(markup).toContain('AutoDine');
    });
  }

  it('does not leave the public navigation pointing to homepage-only anchors', () => {
    for (const page of pages) {
      const markup = renderToStaticMarkup(page.render());
      expect(markup).toContain(`href="${page.route}"`);
      expect(markup).not.toContain('href="/#how"');
      expect(markup).not.toContain('href="/#screens"');
      expect(markup).not.toContain('href="/#status"');
    }
  });
});
