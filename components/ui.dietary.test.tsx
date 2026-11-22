import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JainMark, AllergenBadge } from './ui';

describe('JainMark', () => {
  it('renders nothing for null', () => {
    expect(renderToStaticMarkup(<JainMark jain={null} />)).toBe('');
  });

  it('renders a green Jain mark for true', () => {
    const markup = renderToStaticMarkup(<JainMark jain={true} />);
    expect(markup).toContain('data-jain="jain"');
    expect(markup).toContain('title="Jain"');
    expect(markup).toContain('#1a7f37');
  });

  it('renders a red Non-Jain mark for false', () => {
    const markup = renderToStaticMarkup(<JainMark jain={false} />);
    expect(markup).toContain('data-jain="non"');
    expect(markup).toContain('title="Non-Jain"');
    expect(markup).toContain('#9b2c2c');
  });
});

describe('AllergenBadge', () => {
  it('renders nothing for null or empty', () => {
    expect(renderToStaticMarkup(<AllergenBadge allergens={null} />)).toBe('');
    expect(renderToStaticMarkup(<AllergenBadge allergens={[]} />)).toBe('');
  });

  it('renders a pill per allergen', () => {
    const markup = renderToStaticMarkup(<AllergenBadge allergens={['peanut', 'milk']} />);
    expect(markup).toContain('peanut');
    expect(markup).toContain('milk');
    expect(markup.match(/g-badge/g)?.length).toBe(2);
  });
});
