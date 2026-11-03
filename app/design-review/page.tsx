import type { Metadata } from 'next';
import { DesignOptionsScreen } from '@/components/screens/DesignOptionsScreen';

export const metadata: Metadata = {
  title: 'Design review · AutoDine',
  robots: { index: false },
};

export default function DesignReviewPage() {
  return <DesignOptionsScreen />;
}
