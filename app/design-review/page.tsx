import type { Metadata } from 'next';
import { PrototypeBrowser } from '@/components/design/PrototypeBrowser';

export const metadata: Metadata = {
  title: 'Design review · AutoDine',
  robots: { index: false, follow: false },
};

export default function DesignReviewPage() {
  return <PrototypeBrowser />;
}
