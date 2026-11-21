import type { Metadata } from 'next';
import { BrandingScreen } from '@/components/screens/BrandingScreen';
import { getBrandingScreenData } from '@/lib/db/branding-screen';
import { getOutletBar } from '@/lib/db/outlet-bar';

/**
 * Reads the session through cookies(), so it is never prerendered: a static
 * copy would be the signed-out version for everybody.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Menu branding · AutoDine',
  robots: { index: false, follow: false },
};

export default async function BrandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, data, outlet] = await Promise.all([
    searchParams,
    getBrandingScreenData(),
    getOutletBar(),
  ]);

  return <BrandingScreen data={data} outlet={outlet} error={error} notice={notice} />;
}
