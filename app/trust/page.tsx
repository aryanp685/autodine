import type { Metadata } from 'next';
import { Honest, Trust } from '@/components/screens/HomeScreen';
import { PublicPageShell } from '@/components/marketing/PublicPageShell';

export const metadata: Metadata = {
  title: 'Trust & preview details · AutoDine',
  description: 'Understand AutoDine’s current preview scope, payment boundaries and product limitations.',
};

export default function TrustPage() {
  return (
    <PublicPageShell
      activePage="trust"
      eyebrow="Clear boundaries"
      title={<>A useful preview. <em className="font-normal italic text-forest">No guesswork.</em></>}
      description="See what this build does today, what it does not connect to, and how the guest, kitchen and counter fit together. No customer counts, ratings or readiness claims are invented here."
      exploreHref="/privacy"
      exploreLabel="Read privacy details"
    >
      <Trust />
      <Honest />
    </PublicPageShell>
  );
}
