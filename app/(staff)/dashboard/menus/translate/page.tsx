/**
 * The menu translator — the owner-side half of the translation feature.
 *
 * Works on the same remembered menu as the editor, so switching menus there
 * switches this too. The page loads rows with their saved translations; the
 * review panel (client) generates, edits and saves them.
 */

import type { Metadata } from 'next';
import { MenuTranslateScreen } from '@/components/screens/MenuTranslateScreen';
import { getOutletBar } from '@/lib/db/outlet-bar';
import { getTranslateData } from '@/lib/db/translate';
import { translateConfigured } from '@/lib/ai/translate';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Translate menu · AutoDine',
  robots: { index: false, follow: false },
};

export default async function MenuTranslatePage() {
  const [outlet, data] = await Promise.all([getOutletBar(), getTranslateData()]);

  return (
    <MenuTranslateScreen
      data={data}
      outlet={outlet}
      configured={translateConfigured()}
    />
  );
}
