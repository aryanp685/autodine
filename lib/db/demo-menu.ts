/**
 * Demo menu, built from lib/demo-data.ts, plus the SQL that seeds it.
 *
 * Kept separate from menu.ts on purpose: this module imports nothing from
 * Next.js or Supabase, so `npm run seed:sql` can run it in plain Node.
 *
 * This is SAMPLE DATA for the pilot — a fictional "Saffron & Smoke". It is not
 * a real restaurant and must not be left in place for a live customer.
 */

import { categories as demoCategories, items as demoItems, restaurant as demoRestaurant } from '@/lib/demo-data';
import { rupeesToPaise } from '@/lib/money';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import type { Category, ItemVariant, Menu, MenuItem, Restaurant, RestaurantMenu } from './types';

/** True when reads are served from sample data rather than a database. */
export const usingDemoData = !isSupabaseConfigured;

export const DEMO_RESTAURANT_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_MENU_ID = '00000000-0000-4000-8000-000000000002';

/* --------------------------------------------------------------------------
 * Stable ids
 *
 * The demo data uses readable ids ('starters', 'it-paneer-tikka'). The database
 * uses uuid columns, so those cannot be inserted as-is. Rather than random
 * ids — which would change on every run and break the ON CONFLICT clauses —
 * each id is hashed into a deterministic uuid. Same input, same uuid, always,
 * on any machine and in any Node version. No crypto import, so this file stays
 * safe to bundle for the browser.
 * ------------------------------------------------------------------------ */

function hash128(seed: string): string {
  let out = '';
  for (let round = 0; round < 4; round += 1) {
    // FNV-1a, offset-basis perturbed per round so each 32-bit block differs.
    let h = 0x811c9dc5 ^ Math.imul(round + 1, 0x01000193);
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i) + round;
      h = Math.imul(h, 0x01000193);
    }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

/** Deterministic, syntactically valid UUID derived from `seed`. */
export function stableUuid(seed: string): string {
  const h = hash128(seed);
  const variantNibble = (parseInt(h[16], 16) & 0x3) | 0x8;
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`, // version 4
    `${variantNibble.toString(16)}${h.slice(17, 20)}`, // RFC 4122 variant
    h.slice(20, 32),
  ].join('-');
}

const categoryId = (slug: string) => stableUuid(`category:${slug}`);
const itemId = (slug: string) => stableUuid(`item:${slug}`);
const variantId = (itemSlug: string, variantSlug: string) => stableUuid(`variant:${itemSlug}:${variantSlug}`);

/* -------------------------------------------------------------------------- */

export function demoMenu(slug: string): RestaurantMenu {
  const restaurant: Restaurant = {
    id: DEMO_RESTAURANT_ID,
    slug,
    name: demoRestaurant.name,
    tagline: demoRestaurant.tagline,
    address: demoRestaurant.address,
    phone: demoRestaurant.phone,
    gstin: demoRestaurant.gstin,
    timezone: 'Asia/Kolkata',
    tax_rate_bps: 500,
    is_active: true,
    trial_started_at: '1970-01-01T00:00:00Z',
    created_at: '1970-01-01T00:00:00Z',
  };

  const menu: Menu = {
    id: DEMO_MENU_ID,
    restaurant_id: restaurant.id,
    name: 'Main menu',
    is_published: true,
    sort_order: 0,
  };

  const categories: Category[] = demoCategories.map((c, i) => ({
    id: categoryId(c.id),
    restaurant_id: restaurant.id,
    menu_id: DEMO_MENU_ID,
    name: c.name,
    sort_order: i,
  }));

  const items: MenuItem[] = demoItems.map((it, i) => ({
    id: itemId(it.id),
    restaurant_id: restaurant.id,
    category_id: categoryId(it.category),
    name: it.name,
    description: it.desc ?? null,
    price_paise: rupeesToPaise(it.price),
    is_veg: it.veg,
    is_available: it.available,
    image_url: it.img ?? null,
    sort_order: i,
    variants: (it.variants ?? []).map(
      (v, vi): ItemVariant => ({
        id: variantId(it.id, v.id),
        item_id: itemId(it.id),
        name: v.name,
        price_paise: rupeesToPaise(v.price),
        sort_order: vi,
      }),
    ),
  }));

  return { restaurant, menu, categories, items };
}

/**
 * Seed SQL for the demo restaurant, so the pilot has something to serve.
 * Run this in the Supabase SQL editor AFTER migration 0001.
 * Printed by `npm run seed:sql`.
 */
export function demoSeedSql(slug: string): string {
  const rs = demoMenu(slug);
  const esc = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);

  const lines: string[] = [];
  lines.push('-- Demo seed for the pilot. Idempotent: safe to run more than once.');
  lines.push('-- SAMPLE DATA for a fictional restaurant. Replace before going live.');
  lines.push('');
  lines.push('insert into public.restaurants (id, slug, name, tagline, address, phone, gstin, timezone, tax_rate_bps)');
  lines.push(
    `values ('${DEMO_RESTAURANT_ID}', ${esc(slug)}, ${esc(rs.restaurant.name)}, ${esc(rs.restaurant.tagline)}, ` +
      `${esc(rs.restaurant.address)}, ${esc(rs.restaurant.phone)}, ${esc(rs.restaurant.gstin)}, 'Asia/Kolkata', 500)`,
  );
  lines.push('on conflict (id) do update set name = excluded.name;');

  lines.push('');
  lines.push(
    `insert into public.menus (id, restaurant_id, name, is_published) ` +
      `values ('${DEMO_MENU_ID}', '${DEMO_RESTAURANT_ID}', 'Main menu', true) on conflict (id) do nothing;`,
  );

  lines.push('');
  lines.push('insert into public.categories (id, restaurant_id, menu_id, name, sort_order) values');
  lines.push(
    rs.categories
      .map((c) => `  ('${c.id}', '${DEMO_RESTAURANT_ID}', '${DEMO_MENU_ID}', ${esc(c.name)}, ${c.sort_order})`)
      .join(',\n') + '\non conflict (id) do nothing;',
  );

  lines.push('');
  lines.push(
    'insert into public.items (id, restaurant_id, category_id, name, description, price_paise, is_veg, is_available, image_url, sort_order) values',
  );
  lines.push(
    rs.items
      .map(
        (i) =>
          `  ('${i.id}', '${DEMO_RESTAURANT_ID}', ${i.category_id ? `'${i.category_id}'` : 'null'}, ${esc(i.name)}, ` +
          `${esc(i.description)}, ${i.price_paise}, ${i.is_veg}, ${i.is_available}, ${esc(i.image_url)}, ${i.sort_order})`,
      )
      .join(',\n') + '\non conflict (id) do nothing;',
  );

  const allVariants = rs.items.flatMap((i) => i.variants);
  if (allVariants.length) {
    lines.push('');
    lines.push('insert into public.item_variants (id, item_id, name, price_paise, sort_order) values');
    lines.push(
      allVariants
        .map((v) => `  ('${v.id}', '${v.item_id}', ${esc(v.name)}, ${v.price_paise}, ${v.sort_order})`)
        .join(',\n') + '\non conflict (id) do nothing;',
    );
  }

  lines.push('');
  lines.push('-- Twelve tables and a stable printed QR for each. The staff code is separate.');
  lines.push('insert into public.dining_tables (restaurant_id, label, seats)');
  lines.push(`select '${DEMO_RESTAURANT_ID}', 'T' || n, 4 from generate_series(1, 12) n on conflict do nothing;`);
  lines.push('');
  // Only create one fresh public handle per table on repeated seed runs.
  lines.push('insert into public.table_qr_codes (restaurant_id, table_id, public_token)');
  lines.push(`select '${DEMO_RESTAURANT_ID}', t.id, encode(gen_random_bytes(24), 'hex')`);
  lines.push('from public.dining_tables t');
  lines.push(`where t.restaurant_id = '${DEMO_RESTAURANT_ID}' and t.is_active`);
  lines.push('  and not exists (');
  lines.push('    select 1 from public.table_qr_codes q');
  lines.push('    where q.table_id = t.id and q.revoked_at is null');
  lines.push('  );');

  return lines.join('\n') + '\n';
}
