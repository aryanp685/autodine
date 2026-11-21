import type { Metadata } from 'next';
import { BrandingPreview } from '@/components/screens/BrandingPreview';
import { getBrandingScreenData } from '@/lib/db/branding-screen';
import { getMenuScreenData } from '@/lib/db/menu-screen';
import { getDraftForImport, getOwnAsset } from '@/lib/branding/brand-data';
import { parseTheme } from '@/lib/branding/theme';
import { publicAssetUrl } from '@/lib/storage/assets';

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
 *
 * DRAFT PREVIEWS (migration 20261103000100)
 *
 * ?theme=<json>&name=<text> previews a theme straight from the import
 * review, and ?draft=<importId> loads the saved brand draft. Either way the
 * values pass through parseTheme before they touch the renderer: a query
 * parameter is user input, and only validated values reach the screen. The
 * draft itself is never "published" by looking at it.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Preview · AutoDine',
  robots: { index: false, follow: false },
};

export default async function BrandingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; theme?: string; name?: string; draft?: string }>;
}) {
  const params = await searchParams;
  const branding = await getBrandingScreenData();

  // One read for the menu, using the slug from the membership row -- never a
  // query parameter, which would let an owner preview somebody else's menu.
  const menu = branding?.slug ? await getMenuScreenData(branding.slug) : null;

  /* A draft import: the saved brand draft is fetched through the staff
     context (own restaurant only), and its asset ids resolve to this
     owner's own URLs. */
  let themeOverride: unknown | null = null;
  let nameOverride: string | null = null;
  let logoUrlOverride: string | null = null;
  let bannerUrlOverride: string | null = null;

  const draftId = params.draft?.trim() ?? '';
  if (draftId) {
    const draftResult = await getDraftForImport(draftId);
    const profile = draftResult.ok ? draftResult.value : null;
    if (profile?.draft) {
      themeOverride = profile.draft.theme;
      nameOverride = profile.draft.name;
      if (profile.logoAssetId) {
        const asset = await getOwnAsset(profile.logoAssetId);
        if (asset.ok) logoUrlOverride = assetUrl(asset.value);
      }
      if (profile.bannerAssetId) {
        const asset = await getOwnAsset(profile.bannerAssetId);
        if (asset.ok) bannerUrlOverride = assetUrl(asset.value);
      }
    }
  }

  if (params.theme) {
    // Only a parseable theme is shown; junk renders the default style.
    try {
      themeOverride = JSON.parse(params.theme);
    } catch {
      themeOverride = null;
    }
  }
  if (params.name) nameOverride = params.name.slice(0, 80);

  return (
    <BrandingPreview
      data={branding}
      menu={menu}
      backHref="/dashboard/branding"
      themeOverride={parseTheme(themeOverride ?? null)}
      nameOverride={nameOverride}
      logoUrlOverride={logoUrlOverride}
      bannerUrlOverride={bannerUrlOverride}
      view={params.view === 'desktop' ? 'desktop' : 'mobile'}
    />
  );
}

function assetUrl(asset: { bucket: string; path: string }): string {
  return asset.bucket === 'restaurant-assets'
    ? publicAssetUrl(asset.path) ?? ''
    : // Private source assets need a signed URL; a server component cannot
      // mint one without an extra round trip here, so source assets show as
      // absent in preview rather than broken.
      '';
}
