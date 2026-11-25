import type { MetadataRoute } from 'next';

const STATIC_ROUTES: ReadonlyArray<string> = [
  '/',
  '/features',
  '/how-it-works',
  '/screens',
  '/trust',
  '/pricing',
  '/terms',
  '/privacy',
];

/* Built at build time, where there is no request: no cookies(), no headers()
   and no database read. Restaurant menus are reached by scanning a table QR,
   so only the public marketing pages are listed. */
function configuredOrigin(): string {
  const configured = process.env.SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel.replace(/\/+$/, '')}` : '';
}

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = configuredOrigin();
  return STATIC_ROUTES.map((path) => ({ url: `${origin}${path}` }));
}
