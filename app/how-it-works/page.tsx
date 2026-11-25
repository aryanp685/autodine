import type { Metadata } from 'next';
import { ServiceLoop, Steps } from '@/components/screens/HomeScreen';
import { PublicPageShell } from '@/components/marketing/PublicPageShell';

export const metadata: Metadata = {
  title: 'How it works · AutoDine',
  description: 'Follow a restaurant order from the guest table to the kitchen and counter.',
};

export default function HowItWorksPage() {
  return (
    <PublicPageShell
      activePage="how"
      eyebrow="The service flow"
      title={<>From table scan to <em className="font-normal italic text-forest">settlement.</em></>}
      description="Guests browse and send an order from their phone. The kitchen prepares it. Staff review the bill and record payment at the counter."
      exploreHref="/screens"
      exploreLabel="See each screen"
    >
      <Steps />
      <ServiceLoop />
    </PublicPageShell>
  );
}
