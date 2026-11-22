import { describe, expect, it } from 'vitest';
import { buildKitchenKotHtml } from './kot-print';

const ticket = {
  restaurantName: 'Maddi & Sons',
  ticketCode: 'AD-4F2K1',
  table: 'T3',
  placedAt: '08 Nov 2026, 8:05 pm',
  note: 'Less spicy <please>',
  items: [
    { quantity: 2, name: 'Butter Chicken', portion: 'Half', addons: ['Extra cheese'] },
    { quantity: 1, name: 'Naan', portion: null, addons: [] },
  ],
};

describe('Kitchen order ticket printout', () => {
  it('prints an independent KOT with the kitchen details and no financial information', () => {
    const html = buildKitchenKotHtml(ticket);
    expect(html).toContain('KITCHEN ORDER TICKET · KOT');
    expect(html).toContain('AD-4F2K1');
    expect(html).toContain('T3');
    expect(html).toContain('2×');
    expect(html).toContain('Butter Chicken');
    expect(html).toContain('Half · Extra cheese');
    expect(html).toContain('Less spicy &lt;please&gt;');
    expect(html).toContain('Not a customer invoice or payment receipt');
    expect(html).not.toContain('₹');
    expect(html).not.toContain('Total payable');
    expect(html).not.toContain('Payment status');
  });

  it('escapes all dynamic fields before writing the isolated print document', () => {
    const html = buildKitchenKotHtml({
      ...ticket,
      restaurantName: '<img src=x onerror=alert(1)>',
      table: 'T1<script>alert(1)</script>',
      items: [{ quantity: 1, name: '<script>alert(1)</script>', portion: null, addons: ['& extra'] }],
    });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('T1&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp; extra');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });
});
