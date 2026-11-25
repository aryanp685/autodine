import type { Metadata } from 'next';
import { Screens } from '@/components/screens/HomeScreen';
import { PublicPageShell } from '@/components/marketing/PublicPageShell';

export const metadata: Metadata = {
  title: 'Product screens · AutoDine',
  description: 'View illustrative AutoDine screens for guest ordering, kitchen tickets and counter billing.',
};

export default function ScreensPage() {
  return (
    <PublicPageShell
      activePage="screens"
      eyebrow="Inside the workspace"
      title={<>A closer look at <em className="font-normal italic text-forest">service.</em></>}
      description="Illustrative product screens show the same order from the guest’s phone, to the kitchen board, to the counter bill. The sample data is not a live restaurant account."
      exploreHref="/how-it-works"
      exploreLabel="How it works"
    >
      <Screens />
    </PublicPageShell>
  );
}
