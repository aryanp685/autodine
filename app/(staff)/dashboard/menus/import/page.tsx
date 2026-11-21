/**
 * The menu import screen.
 *
 * Reads the staff context only to decide what to offer: the outlet switcher,
 * the caller's role, and whether they are signed in at all. Parsing and
 * writing happen in server actions, so this page costs one round trip.
 */

import type { Metadata } from 'next';
import { MenuImportScreen } from '@/components/screens/MenuImportScreen';
import { getOutletBar } from '@/lib/db/outlet-bar';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { visionConfigured } from '@/lib/ai/menu-vision';

/**
 * Reads the session through cookies(), so it must never be prerendered: a
 * static copy of this page would be the signed-out version for everybody.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Import a menu · AutoDine',
  robots: { index: false, follow: false },
};

export default async function MenuImportPage() {
  const [outlet, staff] = await Promise.all([getOutletBar(), getStaffContextDetailed()]);

  // 'unconfigured' is demo mode: the text can still be pasted and read, but
  // there is no restaurant to write into, so the save button refuses.
  const blocked = !staff.ok && staff.reason !== 'unconfigured' ? staff.reason : undefined;

  return (
    <MenuImportScreen
      outlet={outlet}
      role={staff.ok ? staff.context.role : undefined}
      blocked={blocked}
      // An environment fact, so it is read here rather than in the screen: the
      // photo path is only offered when a model can actually read the photo.
      visionEnabled={visionConfigured()}
    />
  );
}
