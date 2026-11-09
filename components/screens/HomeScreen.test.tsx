import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Home } from './HomeScreen';
import { PricingScreen } from './PricingScreen';
import { LIVE, NOT_CONNECTED } from '@/lib/plans';

/**
 * The marketing pages' claims, pinned.
 *
 * These are not visual tests. They exist because the two things this pair of
 * pages got wrong were claims, not pixels:
 *
 *   1. A sample-menu detour in place of showing the product. It is gone, and
 *      nothing here may bring it back.
 *   2. Counts typed by hand into headlines ("Six things work. Three do not."),
 *      which stay true only until somebody edits one of the lists. They are
 *      derived now, and this asserts the derivation.
 */
const home = renderToStaticMarkup(<Home />);
const pricing = renderToStaticMarkup(<PricingScreen />);


describe('home', () => {
  it('does not offer a sample menu', () => {
    expect(home).not.toContain('/demo/menu');
    expect(home).not.toContain('sample menu');
  });

  it('shows the product instead, as three real screens', () => {
    expect(home).toContain('data-tour-panel');
    expect(home.match(/data-tour-panel/g)?.length).toBe(3);
    expect(home).toContain('Three screens, in service order.');
  });

  it('gives the problem section a named landmark and three readable cards', () => {
    const section = home.match(/<section[^>]*id="why"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('aria-labelledby="problem-heading"');
    expect(section).toContain('bg-[#FBFAF7]');
    expect(section.match(/<h3/g)).toHaveLength(3);
    expect(section).toContain('The menu is on paper');
    expect(section).toContain('Orders are carried, not sent');
    expect(section).toContain('The bill comes last');
    expect(section).toContain('data-stagger');
    expect(section).toContain('motion-safe:hover:');
    expect(section).not.toContain('text-plum');
  });

  it('renders three ordered process cards with accessible, light styling', () => {
    const section = home.match(/<section[^>]*id="how"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('aria-labelledby="how-heading"');
    expect(section).toContain('bg-white');
    expect(section.match(/data-service-step=/g)).toHaveLength(3);
    expect(section).toContain('aria-label="Restaurant service in three steps"');
    expect(section).toContain('Before service');
    expect(section).toContain('What you need to get started');
    expect(section).toContain('Payment recorded by staff.');
    expect(section).toContain('href="/#screens"');
    expect(section).not.toContain('<button');
    expect(section.match(/<h3/g)).toHaveLength(3);
    expect(section).toContain('STEP 01');
    expect(section).toContain('STEP 03');
    expect(section).toContain('connected phone');
    expect(section).toContain('md:grid-cols-3');
    expect(section).toContain('motion-safe:hover:');
    expect(section).not.toContain('instantly');
    expect(section).not.toContain('text-plum');
  });

  it('labels product mockups honestly and keeps decorative controls out of the tab order', () => {
    const section = home.match(/<section[^>]*id="screens"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('aria-labelledby="screens-heading"');
    expect(section).toContain('Illustrative product previews');
    expect(section.match(/data-tour-panel/g)).toHaveLength(3);
    expect(section.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(section).not.toContain('<button');
    expect(section).toContain('Counter bill');
    expect(section).toContain('Recorded as paid');
    expect(section).toContain('Outstanding');
    expect(section).toContain('does not automatically mark its bill as paid');
    expect(section).toContain('motion-safe:hover:');
    expect(section).toContain('href="/signup"');
    expect(section).toContain('focus-visible:outline-offset-4');
    expect(section).not.toContain('text-plum');
  });

  it('shows four practical product benefits without unsupported promises or fake controls', () => {
    const section = home.match(/<section[^>]*id="product"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('aria-labelledby="features-heading"');
    expect(section.match(/data-product-benefit/g)).toHaveLength(4);
    expect(section.match(/<h3/g)).toHaveLength(4);
    for (const role of ['For your guests','For the kitchen','For the menu manager','For the counter']) expect(section).toContain(role);
    expect(section).toContain('An order placed is not a payment received.');
    expect(section).toContain('href="/#screens"');
    expect(section).toContain('motion-safe:hover:');
    expect(section).toContain('data-stagger');
    expect(section).not.toContain('<button');
    expect(section).not.toMatch(/instantly|same second|unlimited|Works for every room|text-plum/);
  });

  it('finishes the landing palette, status distinction and accessible footer', () => {
    const tail = home.slice(home.indexOf('id="product"'));
    expect(tail).not.toContain('text-plum');
    expect(tail).not.toContain('bg-grass');
    expect(tail).not.toContain('Recommended');
    expect(tail).toContain('bg-forest text-white');
    expect(tail).toContain('Not connected');
    expect(tail).toContain('bg-[#8C857A]');
    expect(tail).toContain('href="/privacy"');
    expect(tail).toContain('href="/terms"');
    expect(tail).not.toContain('ink="#f7f3ea"');
    expect(home).toContain('data-phone-float');
    expect(home).toContain('rgba(251,250,247,0.24)');
  });

  it('keeps preview boundaries and capability lists visible without release-log counts', () => {
    const status = home.slice(home.indexOf('id="status"'), home.indexOf('id="pricing"'));
    for (const item of [...LIVE, ...NOT_CONNECTED]) expect(status).toContain(item.label.replaceAll('&', '&amp;'));
    expect(status).toContain('not a certification for live restaurant operations');
    expect(status).toContain('No SMS or WhatsApp receipts');
    expect(status).toContain('access becomes read-only');
    expect(status).not.toContain('things work.');
    expect(home).toContain('Start your seven-day trial');
    expect(home).toContain('No paid subscription is activated at signup.');
    expect(home).toContain('href="/#status"');
  });

  it('links every plan card to that plan, not to the top of pricing', () => {
    expect(home).toContain('href="/pricing#plan-starter"');
    expect(home).toContain('href="/pricing#plan-professional"');
    expect(home).toContain('href="/pricing#plan-business"');
  });
});

describe('pricing', () => {
  it('does not offer a sample menu', () => {
    expect(pricing).not.toContain('/demo/menu');
  });

  it('does not put a buy button on a plan', () => {
    // The only action on the page is creating an account; no card carries a
    // "Choose" or "Buy" control, because nothing is for sale.
    expect(pricing).not.toMatch(/Choose (Starter|Professional|Business)/);
    expect(pricing).not.toMatch(/>Buy/);
  });

  it('marks every plan as not on sale', () => {
    expect(pricing.match(/Planned · not on sale/g)?.length).toBe(3);
  });

  it('does not promise unlimited usage or indefinite free access', () => {
    expect(pricing).not.toContain('Unlimited orders');
    expect(pricing).not.toContain('Nothing is metered');
    expect(pricing).not.toContain('Free while the product is in preview');
    expect(pricing).toContain('read-only');
    expect(pricing).toContain('7-day trial');
    expect(pricing).not.toContain('Which plan fits');
    expect(pricing).not.toContain('Recommended');
    for (const plan of [{id:'starter'},{id:'professional'},{id:'business'}]) expect(pricing).toContain(`id="plan-${plan.id}"`);
  });
});

describe('the marketing step sections', () => {
  /**
   * These two sections shipped broken: their markup used `.flow`, `.flow__step`
   * and `.flow__steps`, which are the guest ordering flow's own class names in
   * styles/guest.css. That file loads later, so on the live site the four steps
   * were drawn as progress-bar segments and their text overflowed on top of
   * itself. lib/style-scopes.test.ts guards the stylesheets; this guards the
   * markup that has to use the prefixed names.
   */
  it('never borrows the guest flow’s class names', () => {
    // The home page is Tailwind now, so the specific `pflow__` prefix that
    // replaced `.flow` here no longer exists. What still has to hold -- and is
    // the reason this test was written -- is that no marketing markup uses the
    // guest flow's own names, because styles/guest.css loads after this page
    // and used to redraw the four steps as progress-bar segments.
    for (const html of [home, pricing]) {
      expect(html).not.toContain('class="flow');
      expect(html).not.toMatch(/class="[^"]*\bflow__/);
    }
  });
});
