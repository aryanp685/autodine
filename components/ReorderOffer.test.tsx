import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReorderButton } from './ReorderOffer';

/**
 * What "order these again" says, and what it must not say.
 *
 * The button lives on a screen that is already about an order that succeeded.
 * A second offer next to it can easily read as a second order, or as a promise
 * that the kitchen has been told — either would be a lie about something the
 * guest is about to pay for.
 */
describe('the reorder offer', () => {
  const html = (count = 2) =>
    renderToStaticMarkup(<ReorderButton count={count} onRestore={() => {}} />);

  it('says the dishes go into the cart, and that prices are shown again', () => {
    const markup = html(2);
    const text = markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    expect(text).toContain('Order these again');
    expect(text).toContain('Put the same ones back in your cart');
    expect(text).toContain('you see the prices again before anything is sent');
  });

  it('never claims the order was placed by tapping it', () => {
    const text = html().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

    // "ordered" appears only in the past tense about the previous order; the
    // button itself promises nothing about a new one.
    expect(text).not.toContain('order placed');
    expect(text).not.toContain('sent to the kitchen');
    expect(text).not.toContain('we will order');
  });

  it('counts the dishes it will put back, singular included', () => {
    expect(html(1).replace(/<[^>]+>/g, ' ')).toContain('Ordered one dish');
    expect(html(3).replace(/<[^>]+>/g, ' ')).toContain('Ordered 3 dishes');
  });

  it('is a secondary action, not a second primary', () => {
    // One filled action colour per screen: the dock already has it.
    const markup = html();
    expect(markup).toContain('data-reorder-button');
    expect(markup).toContain('g-quiet');
    expect(markup).not.toContain('g-primary');
  });
});
