import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SiteFooter } from './SiteFooter';

describe('SiteFooter', () => {
  it('renders address and phone when both are provided', () => {
    const html = renderToStaticMarkup(
      <SiteFooter address="14 Civil Lines, Near Zero Mile, Nagpur 440001, Maharashtra" phone="+91 712 000 0000" />,
    );
    expect(html).toContain('14 Civil Lines, Near Zero Mile, Nagpur 440001, Maharashtra');
    expect(html).toContain('+91 712 000 0000');
  });

  it('renders only the address when phone is absent', () => {
    const html = renderToStaticMarkup(<SiteFooter address="14 Civil Lines, Nagpur" />);
    expect(html).toContain('14 Civil Lines, Nagpur');
    expect(html).not.toContain('712');
  });

  it('renders only the phone when address is absent', () => {
    const html = renderToStaticMarkup(<SiteFooter phone="+91 712 000 0000" />);
    expect(html).toContain('+91 712 000 0000');
    expect(html).not.toContain('Civil Lines');
  });

  it('renders no contact line when neither address nor phone is provided', () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    expect(text).not.toContain('civil lines');
    expect(text).not.toContain('712');
  });
});
