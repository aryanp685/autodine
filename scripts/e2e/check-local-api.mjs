import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const slug = 'kings-of-kings';
const token = 'localcard0000000000000000000000000000000000000000000000000001';

if (!url || !anonKey) throw new Error('Local Supabase-compatible URL and anon JWT are required.');

const client = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function check(label, query) {
  const { data, error } = await query;
  if (error) {
    console.error(`FAIL ${label}: ${error.code ?? 'no code'} ${error.message}`);
    process.exitCode = 1;
    return null;
  }
  console.log(`PASS ${label}`);
  return data;
}

// The storefront read goes through `public_restaurant_profile`, exactly as
// lib/db/public-restaurant.ts does it. Migration 20261110000700 drops the
// guest-readable policy on public.restaurants, so a direct `.from('restaurants')`
// returns nothing for anon from that migration onwards. This preflight mirrors
// the shipped code path, not the historical one.
const storefront = await check(
  'getStorefrontStatusBySlug storefront read (public_restaurant_profile)',
  client.rpc('public_restaurant_profile', { p_slug: slug }).maybeSingle(),
);
if (!storefront || storefront.is_active === false) throw new Error('Synthetic restaurant is missing or inactive.');

const intro = await check(
  'public_qr_intro read-only RPC',
  client.rpc('public_qr_intro', { p_public_token: token }),
);
const introRow = Array.isArray(intro) ? intro[0] : null;
if (!introRow || introRow.restaurant_slug !== slug) throw new Error('Synthetic scan card did not resolve to the expected restaurant.');

const restaurant = await check(
  'getRestaurantMenu restaurant lookup (public_restaurant_profile)',
  client.rpc('public_restaurant_profile', { p_slug: slug }).maybeSingle(),
);
if (!restaurant) throw new Error('Synthetic restaurant row is not available through the public projection.');

// The contract 20261110000700 asserts: a guest reaches one storefront by slug
// through the function, and cannot enumerate or read the tenant table directly.
// PostgREST answers an RLS denial with an empty body rather than an error, so
// this is an assertion on the rows, not on `error`.
const direct = await client.from('restaurants').select('id').eq('slug', slug);
if (direct.error) {
  console.error(`FAIL direct guest read of public.restaurants should be refused, not error: ${direct.error.message}`);
  process.exitCode = 1;
} else if ((direct.data ?? []).length > 0) {
  console.error('FAIL public.restaurants is still readable by anon: 20261110000700 did not take effect.');
  process.exitCode = 1;
} else {
  console.log('PASS direct guest read of public.restaurants is refused by row security');
}

const menus = await check(
  'published menus read',
  client.from('menus')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true }),
);
if (!menus?.length) throw new Error('Synthetic restaurant has no published menu.');
const menu = menus[0];

const categories = await check(
  'menu categories read',
  client.from('categories')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .eq('menu_id', menu.id)
    .order('sort_order', { ascending: true }),
);
const categoryIds = (categories ?? []).map((category) => category.id);

const items = categoryIds.length
  ? await check(
      'available items and item_variants relationship read',
      client.from('items')
        .select('*, item_variants(*)')
        .in('category_id', categoryIds)
        .eq('is_available', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    )
  : [];
if (!items?.length) throw new Error('Synthetic menu has no available item.');

const itemIds = items.map((item) => item.id);
const addonGroups = itemIds.length
  ? await check(
      'item_addon_groups read',
      client.from('item_addon_groups')
        .select('id, item_id, name, min_select, max_select, sort_order')
        .in('item_id', itemIds)
        .order('sort_order', { ascending: true }),
    )
  : [];
const groupIds = (addonGroups ?? []).map((group) => group.id);
if (groupIds.length) {
  await check(
    'item_addons read',
    client.from('item_addons')
      .select('id, group_id, name, price_paise, is_available, sort_order')
      .in('group_id', groupIds)
      .eq('is_available', true)
      .order('sort_order', { ascending: true }),
  );
}

if (process.exitCode) process.exit(process.exitCode);
console.log('All read-only local API preflights passed; no scan budget or order was written.');
