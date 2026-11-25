import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicIntroLoader } from './PublicIntroLoader';

describe('public intro loader', () => {
  it('renders an accessible, full-screen first-visit welcome state', () => {
    const markup = renderToStaticMarkup(<PublicIntroLoader />);
    expect(markup).toContain('data-public-intro');
    expect(markup).toContain('data-stage="show"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Loading AutoDine experience"');
    expect(markup).toContain('Scan');
    expect(markup).toContain('Order');
    expect(markup).toContain('Enjoy');
    expect(markup).toContain('Setting up your dining experience');
    expect(markup).toContain('public-intro-loader__spinner');
  });
});
