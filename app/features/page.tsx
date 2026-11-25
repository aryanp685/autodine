import type { Metadata } from 'next';
import { Features } from '@/components/screens/HomeScreen';
import { PublicPageShell } from '@/components/marketing/PublicPageShell';

export const metadata: Metadata = {
  title: 'Features · AutoDine',
  description: 'See how AutoDine connects digital menus, table orders, kitchen tickets and counter billing.',
};

export default function FeaturesPage() {
  return (
    <PublicPageShell
      activePage="product"
      eyebrow="AutoDine product"
      title={<>One workspace for <em className="font-normal italic text-forest">every hand-off.</em></>}
      description="Explore the guest menu, kitchen board, menu tools and counter workflow. A practical preview of what each part does — without pretending an unconnected feature is live."
      exploreHref="/screens"
      exploreLabel="See product screens"
    >
      <Features />
    </PublicPageShell>
  );
}
