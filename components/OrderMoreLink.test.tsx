import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderMoreLink } from './OrderMoreLink';

describe('OrderMoreLink', () => {
  it('opens the menu for a deliberate next round', () => {
    const html = renderToStaticMarkup(<OrderMoreLink href="/menu?s=demo" />);
    expect(html).toContain('href="/menu?s=demo"');
    expect(html).toContain('Order something else');
  });
});
