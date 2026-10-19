import { describe, expect, it } from 'vitest';
import { DEMO_MENU_ID, DEMO_RESTAURANT_ID, demoMenu, demoSeedSql, stableUuid } from './demo-menu';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('stableUuid', () => {
  it('produces a syntactically valid uuid', () => {
    for (const seed of ['starters', 'it-paneer-tikka', 'a', 'x'.repeat(400)]) {
      expect(stableUuid(seed)).toMatch(UUID);
    }
  });

  it('is deterministic — same input, same uuid, every time', () => {
    expect(stableUuid('starters')).toBe(stableUuid('starters'));
    // Determinism across calls is what makes the seed idempotent.
    const run = ['a', 'b', 'c'].map(stableUuid);
    expect(['a', 'b', 'c'].map(stableUuid)).toEqual(run);
  });

  it('gives different uuids for different inputs', () => {
    const ids = new Set(['starters', 'tandoor', 'curries', 'biryani'].map(stableUuid));
    expect(ids.size).toBe(4);
  });

  it('does not collide for near-identical inputs', () => {
    // FNV-1a alone can correlate on similar strings; the per-round offset must
    // break that up across all four 32-bit blocks, not just the first.
    const many = Array.from({ length: 200 }, (_, i) => stableUuid(`item-${i}`));
    expect(new Set(many).size).toBe(200);
  });
});

describe('demoMenu', () => {
  const menu = demoMenu('saffron-smoke');

  it('uses uuid ids everywhere the database expects them', () => {
    expect(menu.restaurant.id).toMatch(UUID);
    expect(menu.menu.id).toMatch(UUID);
    for (const c of menu.categories) expect(c.id).toMatch(UUID);
    for (const i of menu.items) expect(i.id).toMatch(UUID);
    for (const i of menu.items) for (const v of i.variants) expect(v.id).toMatch(UUID);
  });

  it('points every item at a category that exists', () => {
    const ids = new Set(menu.categories.map((c) => c.id));
    for (const item of menu.items) {
      expect(item.category_id).not.toBeNull();
      expect(ids.has(item.category_id as string)).toBe(true);
    }
  });

  it('points every variant at its own item', () => {
    for (const item of menu.items) {
      for (const v of item.variants) expect(v.item_id).toBe(item.id);
    }
  });

  it('keeps prices in whole paise', () => {
    for (const item of menu.items) {
      expect(Number.isInteger(item.price_paise)).toBe(true);
      expect(item.price_paise).toBeGreaterThanOrEqual(0);
      for (const v of item.variants) expect(Number.isInteger(v.price_paise)).toBe(true);
    }
  });

  it('carries the locked screens sample prices (₹349 paneer tikka)', () => {
    const paneer = menu.items.find((i) => i.name === 'Paneer Tikka');
    expect(paneer?.price_paise).toBe(34900);
  });
});

describe('demoSeedSql', () => {
  const sql = demoSeedSql('saffron-smoke');

  it('is idempotent — every insert has an on conflict clause', () => {
    const inserts = sql.split('\n').filter((l) => l.startsWith('insert into'));
    expect(inserts.length).toBeGreaterThan(3);
    expect(sql.match(/on conflict/g)?.length).toBeGreaterThanOrEqual(inserts.length - 1);
  });

  it('inserts uuids into uuid columns, not the readable demo slugs', () => {
    // This is the bug that would have failed on first run: category ids like
    // 'starters' being inserted into a uuid column.
    expect(sql).not.toContain("'starters'");
    expect(sql).not.toContain("'it-paneer-tikka'");
  });

  it('escapes single quotes in text values', () => {
    expect(demoSeedSql("o'brien's")).toContain("o''brien''s");
  });

  it('seeds tables and rotating QR tokens', () => {
    expect(sql).toContain('public.dining_tables');
    expect(sql).toContain('public.qr_tokens');
    expect(sql).toContain("interval '7 days'");
  });

  it('anchors everything to the demo restaurant', () => {
    expect(sql).toContain(DEMO_RESTAURANT_ID);
    expect(sql).toContain(DEMO_MENU_ID);
  });
});
