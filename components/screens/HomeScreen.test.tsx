import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Home } from './HomeScreen';
import { PricingScreen } from './PricingScreen';
import { BILLING, LIVE, NOT_CONNECTED, PLANS } from '@/lib/plans';
import { TRIAL_DAYS } from '@/lib/trial';

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
    expect(home).toMatch(/Three screens, in\s*<em[^>]*>service order\.<\/em>/);
  });

  it('gives the problem section a named landmark and three readable cards', () => {
    const section = home.match(/<section[^>]*id="why"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('aria-labelledby="problem-heading"');
    expect(section).toContain('bg-ink');
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

  it('tells one illustrative order’s hand-off without depending on the pin', () => {
    const section =
      home.match(/<section[^>]*aria-labelledby="loop-heading"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('data-loop');
    expect(section.match(/data-loop-station/g)).toHaveLength(3);
    expect(section).toContain('data-loop-ticket');
    expect(section).toContain('Illustrative order');
    expect(section).toContain('AD-1042');
    expect(section).toContain('Nothing is charged online.');
    for (const status of ['Order sent', 'Preparing', 'Awaiting payment']) {
      expect(section).toContain(status);
    }
    expect(section).not.toContain('<button');
    expect(section).not.toContain('instantly');
    expect(section).not.toContain('text-plum');
  });

  it('plays the sample menu in the hero as an honest, tappable preview', () => {
    const section = home.match(/<section[^>]*data-hero[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('data-menu-demo');
    expect(section).toContain('aria-label="Interactive demo of the guest menu"');
    expect(section.match(/data-menu-dish/g)).toHaveLength(6);
    expect(section).toContain('aria-pressed="true"');
    expect(section).toContain('Paneer Tikka');
    expect(section).toContain('Butter Chicken');
    expect(section).toContain('Sample order');
    expect(section).toContain('Live demo · sample dishes and prices');
    expect(section).not.toMatch(/pay now|pay online|checkout/i);
  });

  it('earns trust with enforced facts instead of badges', () => {
    const section = home.match(/<section[^>]*id="trust"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('aria-labelledby="trust-heading"');
    expect(section).toContain('Built for the counter');
    expect(section.match(/data-trust-point/g)).toHaveLength(4);
    expect(section).toContain('Nothing is charged online.');
    expect(section).toContain('Row-level security');
    expect(section).toContain('whole paise');
    expect(section).toContain('No guest accounts');
    expect(section).toContain('href="/privacy"');
    expect(section).toContain('href="/terms"');
    expect(section).not.toMatch(/certified|bank-grade|PCI|GDPR|DPDP|100%/i);
  });

  it('labels product mockups honestly and keeps decorative controls out of the tab order', () => {
    const section = home.match(/<section[^>]*id="screens"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain('aria-labelledby="screens-heading"');
    expect(section).toContain('Illustrative screens');
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
    expect(tail).toContain('bg-mute-dim');
    expect(tail).toContain('href="/privacy"');
    expect(tail).toContain('href="/terms"');
    expect(tail).not.toContain('ink="#f7f3ea"');
    expect(home).toContain('data-menu-demo');
    expect(home).toContain('rgba(255,255,255,0.24)');
  });

  it('keeps preview boundaries and capability lists visible without release-log counts', () => {
    const status = home.slice(home.indexOf('id="status"'), home.indexOf('id="pricing"'));
    for (const item of [...LIVE, ...NOT_CONNECTED]) expect(status).toContain(item.label.replaceAll('&', '&amp;'));
    expect(status).toContain('no sample data mixed in');
    expect(status).toContain('No SMS or WhatsApp receipts');
    expect(status).toContain('through Cashfree');
    expect(status).not.toContain('things work.');
    expect(home).toContain(`Start your ${TRIAL_DAYS}-day trial`);
    expect(home).toContain('No card needed at signup');
    expect(home).toContain('href="/#status"');
  });

  it('links every plan card to that plan, not to the top of pricing', () => {
    expect(home).toContain('href="/pricing#plan-starter"');
    expect(home).toContain('href="/pricing#plan-professional"');
    expect(home).toContain('href="/pricing#plan-business"');
  });

  it('indexes the sections once and marks only the forest bands as dark', () => {
    expect(home.match(/data-section-rail/g)).toHaveLength(1);
    for (const id of ['how', 'screens', 'product', 'trust', 'status', 'pricing']) {
      expect(home).toContain(`href="#${id}"`);
    }
    expect(home.match(/data-rail-tone="dark"/g)).toHaveLength(2);
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

  it('shows plans as billable through Cashfree, not as planned prices', () => {
    expect(pricing).toContain('billed through Cashfree');
    expect(pricing).not.toContain('not on sale');
    expect(pricing).not.toContain('Planned ·');
  });

  it('compares the catalog the product enforces, not a second list', () => {
    const start = pricing.indexOf('id="compare"');
    const end = pricing.indexOf('aria-labelledby="included-heading"');
    const section = pricing.slice(start, end);
    expect(section).toContain('aria-labelledby="compare-heading"');
    expect(section.match(/data-matrix-row/g)).toHaveLength(10);
    for (const plan of PLANS) expect(section).toContain(`data-matrix-plan="${plan.id}"`);
    expect(section).toContain('Outlets on one account');
    expect(section).toContain('Unlimited');
    expect(section).toContain('Not included');
    expect(section).not.toContain('Recommended');
    expect(section).toContain(`What the ${BILLING.trialDays} days look like`);
    expect(section).toContain('Read-only, not deleted');
    expect(section).not.toMatch(/Choose|Buy now/);
  });

  it('answers the questions a buyer actually asks', () => {
    expect(pricing).toContain('What happens to my data if I don’t continue?');
    expect(pricing).toContain('Are these prices final, and are taxes included?');
    expect(pricing).toContain('Can one account run more than one outlet?');
    expect(pricing.match(/name="pricing-faq"/g)).toHaveLength(6);
  });

  it('does not promise unlimited usage or indefinite free access', () => {
    expect(pricing).not.toContain('Unlimited orders');
    expect(pricing).not.toContain('Nothing is metered');
    expect(pricing).not.toContain('Free while the product is in preview');
    expect(pricing).toContain('read-only');
    expect(pricing).toContain(`${TRIAL_DAYS}-day trial`);
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
