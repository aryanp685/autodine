import { describe, expect, it } from 'vitest';

import { jsonLdMarkup } from './StructuredData';

describe('JSON-LD in the public menu', () => {
  it('cannot be closed early by a restaurant name', () => {
    const markup = jsonLdMarkup({
      '@type': 'Restaurant',
      name: '</script><img src=x onerror=alert(document.domain)>',
    });
    expect(markup).not.toContain('</script>');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('>');
  });

  it('escapes the HTML entities and JS line separators a parser must not see raw', () => {
    const markup = jsonLdMarkup({ address: 'A & B', note: 'line\u2028sep\u2029end' });
    expect(markup).not.toContain('&');
    expect(markup).not.toContain('\u2028');
    expect(markup).not.toContain('\u2029');
  });

  it('keeps the value a JSON parser reads exactly as written', () => {
    const name = 'Café <Saffron> & Co';
    expect(JSON.parse(jsonLdMarkup({ name }))).toEqual({ name });
  });
});
