import { MetadataRoute } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const STATIC_ROUTES: ReadonlyArray<string> = ['/', '/pricing', '/terms', '/privacy'];

const generateSitemaps = async (): Promise<MetadataRoute.Sitemap[]> => {
  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((url) => ({ url }));

  const client = await createSupabaseServerClient();
  if (!client) return [entries];

  try {
    const { data, error } = await client.from('restaurants').select('slug').eq('is_active', true);
    if (error || !data) return [entries];

    for (const row of data) {
      const slug = String(row.slug ?? '').trim();
      if (!slug) continue;
      entries.push({ url: `/menu?s=${slug}` });
    }
  } catch {
    // The database is unavailable or the read is not permitted: static routes only.
  }

  return [entries];
}

export { generateSitemaps };
export default generateSitemaps;
