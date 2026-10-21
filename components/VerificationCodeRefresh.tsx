'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps the on-site code panel from showing a code that has already rolled.
 *
 * WHY THIS EXISTS
 *
 * The code is derived from a time window, not stored, so the database is
 * always right -- but a dashboard tab left open on the host desk is not. It
 * would show whatever was rendered when it was loaded, and a member of staff
 * reading yesterday's digits to a guest produces a wrong-code rejection that
 * looks like the feature is broken.
 *
 * So the panel asks the server to re-render when the window ends. One timer,
 * one navigation, no polling loop: the server decides the next code, as it
 * did for the first one.
 *
 * It renders nothing. The countdown it could draw would have to be formatted
 * for a clock that the server and the browser may disagree about, and a number
 * that changes under a staff member's eyes while they are reading it out is
 * worse than the sentence already on the panel.
 */
export function VerificationCodeRefresh({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();

  useEffect(() => {
    const boundary = Date.parse(expiresAt);
    if (Number.isNaN(boundary)) return;

    // A second and a half after the window ends: the next code must already
    // exist in the database when the refreshed render asks for it.
    const delay = Math.max(boundary - Date.now() + 1500, 1500);
    const timer = setTimeout(() => router.refresh(), delay);

    return () => clearTimeout(timer);
  }, [expiresAt, router]);

  return null;
}
