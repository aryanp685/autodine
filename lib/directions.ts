/**
 * AutoDine — Phase 1 prototype registry.
 * Three design directions + the screen inventory for the first review round.
 */

export type DirectionId = 'a' | 'b' | 'c';

export type Direction = {
  id: DirectionId;
  code: string;
  name: string;
  summary: string;
  /** Design character, shown on the comparison hub. */
  character: string[];
  strengths: string[];
  weaknesses: string[];
  palette: { name: string; hex: string; role: string }[];
  typeNote: string;
  navNote: string;
};

export const directions: Record<DirectionId, Direction> = {
  a: {
    id: 'a',
    code: 'Option A',
    name: 'Editorial Minimal',
    summary:
      'Large typography, generous whitespace, restrained colour, elegant restaurant imagery. Reads like a premium restaurant brand rather than a software tool.',
    character: [
      'Display type carries the hierarchy',
      'Hairline rules instead of boxes and shadows',
      'Full-bleed photography on public pages',
      'Dashboards breathe — fewer cards, more air',
    ],
    strengths: [
      'Strongest brand impression for the public website and owner pitch',
      'Very legible customer menu at any age group',
      'Photography sells the food well',
      'Timeless; unlikely to look dated quickly',
    ],
    weaknesses: [
      'Lower information density — a busy kitchen board needs care at high order volume',
      'Large type can push key operational numbers below the fold',
      'Requires good photography to look its best',
    ],
    palette: [
      { name: 'Ink', hex: '#111318', role: 'Text, primary surfaces in dark sections' },
      { name: 'Warm White', hex: '#F6F6F3', role: 'Page background' },
      { name: 'Muted Sage', hex: '#6D7F70', role: 'Accent, success, vegetarian marker' },
      { name: 'Sand', hex: '#E8E2D8', role: 'Cards, dividers, image frames' },
      { name: 'Alert', hex: '#C75B50', role: 'Errors, unpaid, destructive' },
    ],
    typeNote: 'Inter at large display sizes (48–88 px) with tight tracking; body 16–17 px; generous line height 1.6.',
    navNote: 'Public: minimal top bar. Dashboard: slim left rail with generous spacing, no icons-only mode.',
  },
  b: {
    id: 'b',
    code: 'Option B',
    name: 'Modern Operations',
    summary:
      'Compact but clean dashboards, highly visible operational states, efficient navigation. Built for staff who live in it all service long.',
    character: [
      'State-first: payment and prep status are the loudest thing on screen',
      'Dense tables and sortable lists',
      'Soft Blue used as a cool operational surface',
      'Persistent top bar with keyboard-friendly shortcuts',
    ],
    strengths: [
      'Best for kitchen and cashier screens under pressure',
      'Highest information density without feeling cramped',
      'Operational states (new / preparing / ready / unpaid) are unmistakable',
      'Scales to many tables and many concurrent orders',
    ],
    weaknesses: [
      'Less emotive on the public marketing site',
      'Needs discipline to avoid feeling like a spreadsheet',
      'More visual rules to maintain',
    ],
    palette: [
      { name: 'Ink', hex: '#111318', role: 'Text, headers, dark top bar' },
      { name: 'Warm White', hex: '#F6F6F3', role: 'Page background' },
      { name: 'Soft Blue', hex: '#DDE7F2', role: 'Selected rows, informational chips' },
      { name: 'Muted Sage', hex: '#6D7F70', role: 'Ready / paid states' },
      { name: 'Alert', hex: '#C75B50', role: 'Unpaid, overdue, failed' },
    ],
    typeNote: 'Inter with a tighter scale: 13–14 px for data, 15–16 px for headings, tabular numerals for all money and times.',
    navNote: 'Public: compact top bar with product menu. Dashboard: fixed icon + label sidebar (collapsible) plus a second-level tab strip.',
  },
  c: {
    id: 'c',
    code: 'Option C',
    name: 'Warm Hospitality',
    summary:
      'Softer surfaces, restaurant-oriented visual character, approachable customer ordering. Feels like a welcome, not a checkout.',
    character: [
      'Rounded cards, soft shadows, Sand-forward surfaces',
      'Warm accent pairings; photography treated with rounded frames',
      'Customer flow uses large tap targets and a friendly voice',
      'Owner dashboard uses warm cards with clear, calm hierarchy',
    ],
    strengths: [
      'Most approachable customer ordering experience',
      'Strong on mobile where most customers will scan and order',
      'Brand-friendly: restaurant themes sit naturally on top',
      'Feels premium without feeling cold',
    ],
    weaknesses: [
      'Softness can weaken urgency signals in the kitchen',
      'Rounded, shadowed cards reduce usable space on dense screens',
      'Needs careful contrast testing on Sand surfaces',
    ],
    palette: [
      { name: 'Ink', hex: '#111318', role: 'Text' },
      { name: 'Warm White', hex: '#F6F6F3', role: 'Page background' },
      { name: 'Sand', hex: '#E8E2D8', role: 'Primary card surface' },
      { name: 'Muted Sage', hex: '#6D7F70', role: 'Accent, vegetarian marker, success' },
      { name: 'Alert', hex: '#C75B50', role: 'Unpaid, errors, sold out' },
    ],
    typeNote: 'Inter with a warmer scale: rounded display 32–56 px, body 16 px, comfortable 1.65 line height, heavier use of medium weight.',
    navNote: 'Public: warm floating header. Dashboard: card-based grid home plus top tabs. Customer: sticky bottom bar for cart.',
  },
};

export type ScreenDef = {
  slug: string;
  title: string;
  group: 'Public website' | 'Owner dashboard' | 'Customer' | 'Kitchen' | 'Cashier' | 'Cross-cutting';
  note: string;
  /** true when this screen has a bespoke layout per direction, false when it is shared markup with three skins. */
  bespoke: boolean;
};

export const screens: ScreenDef[] = [
  { slug: 'home', title: 'Home', group: 'Public website', note: 'Hero, value proposition, plan teaser', bespoke: true },
  { slug: 'pricing', title: 'Pricing', group: 'Public website', note: 'Locked INR prices, plan comparison, trial terms', bespoke: false },
  { slug: 'signup', title: 'Sign up', group: 'Public website', note: 'Account creation with trial disclosure', bespoke: false },
  { slug: 'dashboard', title: 'Dashboard overview', group: 'Owner dashboard', note: 'Today at a glance, trial banner, live orders', bespoke: true },
  { slug: 'menu-editor', title: 'Menu editor', group: 'Owner dashboard', note: 'Categories, items, availability, publish flow', bespoke: false },
  { slug: 'tables', title: 'Tables & QR', group: 'Owner dashboard', note: 'QR statuses, revoke, regenerate, print sheet', bespoke: false },
  { slug: 'customer-menu', title: 'Customer menu', group: 'Customer', note: 'Verified table session, categories, availability', bespoke: true },
  { slug: 'item', title: 'Item customization', group: 'Customer', note: 'Variants, modifiers, add-ons, quantity', bespoke: true },
  { slug: 'cart', title: 'Cart', group: 'Customer', note: 'Review, charges, taxes, totals', bespoke: true },
  { slug: 'checkout', title: 'Checkout', group: 'Customer', note: 'Online payment vs pay at counter', bespoke: true },
  { slug: 'kitchen', title: 'Kitchen board', group: 'Kitchen', note: 'New / preparing / ready / served, unpaid flag, audio', bespoke: true },
  { slug: 'cashier', title: 'Cashier', group: 'Cashier', note: 'Counter-payment queue, record payment, receipt', bespoke: true },
  { slug: 'states', title: 'States & trial UI', group: 'Cross-cutting', note: 'Loading, empty, error, success, disabled, trial & subscription', bespoke: false },
];

export const screenBySlug = (slug: string) => screens.find((s) => s.slug === slug);
export const directionList: Direction[] = [directions.a, directions.b, directions.c];
