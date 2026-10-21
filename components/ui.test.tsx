import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Money } from './ui';

/**
 * Money is the one component every money screen in the product renders
 * through, so its unit is worth pinning down.
 *
 * The bug this guards: `Money` used to hand its value straight to `inr()`
 * without dividing by 100. Demo rows held rupees so previews looked right,
 * while every live figure on the dashboard -- which holds paise -- read one
 * hundred times too large. A day of Rs 1,557.60 was shown as Rs 1,55,760.
 */
describe('Money', () => {
  it('reads paise, not rupees', () => {
    expect(renderToStaticMarkup(<Money value={155_760} />)).toContain('₹1,558');
  });

  it('renders a small amount without inflating it', () => {
    expect(renderToStaticMarkup(<Money value={25_000} />)).toContain('₹250');
  });

  it('renders zero as zero', () => {
    expect(renderToStaticMarkup(<Money value={0} />)).toContain('₹0');
  });
});
