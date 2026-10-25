import type { Metadata } from 'next';
import { BrandingPreview } from '@/components/screens/BrandingPreview';
import { getBrandingScreenData } from '@/lib/db/branding-screen';
import { getMenuScreenData } from '@/lib/db/menu-screen';

/**
 * The owner's own menu, as a guest sees it, without a table.
 *
 * WHY THIS ROUTE EXISTS
 *
 * The real menu lives behind the QR/table gate, and it must: that gate is what
 * proves a guest is actually seated. But an owner checking a logo cannot scan
 * their own card, and "trust me, it will look right" is how a restaurant ends
 * up live with a photo of a car as its banner.
 *
 * So this renders the SAME `MenuIdentity` component against the SAME published
 * menu data, behind the owner's session instead of the gate. It can never show
 * a restaurant the caller does not manage -- the id comes from the membership
 * row -- and it cannot be reached by a guest, because /dashboard is behind
 * proxy.ts.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Preview · AutoDine',
  robots: { index: false, follow: false },
};

export default async function BrandingPreviewPage() {
  const branding = await getBrandingScreenData();

  // One read for the menu, using the slug from the membership row -- never a
  // query parameter, which would let an owner preview somebody else's menu.
  const menu = branding?.slug ? await getMenuScreenData(branding.slug) : null;

  return (
    <BrandingPreview
      data={branding}
      menu={menu}
      backHref="/dashboard/branding"
    />
  );
}
