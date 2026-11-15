/**
 * The closed set of GST regular-taxation profiles AutoDine can configure.
 *
 * THERE IS NO ARBITRARY RATE ENTRY. A restaurant chooses between exactly two
 * regular profiles, each effective-dated and each carrying its statutory
 * reference. Anything else is rejected — at the type level, in this module,
 * in the database guard (20261113000100_gst_two_mode.sql) and in the server
 * actions.
 *
 *   REGULAR_5   5%  (2.5% CGST + 2.5% SGST) — restaurant/catering services
 *               supplied OTHER THAN in specified premises. NO ITC.
 *               [Notification No. 11/2017-CT(Rate), as amended; 5% without ITC]
 *
 *   REGULAR_18  18% (9% CGST + 9% SGST) — restaurant/catering services in
 *               SPECIFIED PREMISES (hotel accommodation above the declared
 *               tariff band). ITC available subject to the statutory rules.
 *               Effective 2025-04-01 per Notification No. 05/2025-CT(Rate).
 *               NOT AVAILABLE unless the specified-premises evidence is on
 *               file: a standalone restaurant (no hotel accommodation) can
 *               NEVER self-declare into this profile.
 *
 * Composition is NOT a rate; it is a separate status (lib/gst/composition.ts)
 * with its own Bill of Supply and no separately-collected GST.
 */

export type GstRegularProfile = 'other_than_specified_premises' | 'specified_premises';

export const REGULAR_PROFILES = {
  other_than_specified_premises: {
    profile: 'other_than_specified_premises' as const,
    rateBps: 500,
    cgstBps: 250,
    sgstBps: 250,
    igstBps: 500,
    itc: false,
    premises: 'other_than_specified_premises',
    notification: 'Notification No. 11/2017-CT(Rate), Sl. 7(i), as amended — 5% without ITC',
  },
  specified_premises: {
    profile: 'specified_premises' as const,
    rateBps: 1800,
    cgstBps: 900,
    sgstBps: 900,
    igstBps: 1800,
    itc: true,
    premises: 'specified_premises',
    notification: 'Notification No. 05/2025-CT(Rate), w.e.f. 2025-04-01 — 18%, ITC subject to rules, specified premises only',
  },
} as const;

export type GstProfileId = keyof typeof REGULAR_PROFILES;
export type GstMode = 'off' | 'regular' | 'composition';

export const GST_MODES: readonly GstMode[] = ['off', 'regular', 'composition'] as const;

/**
 * Effective-dated profile resolution. Config rows are stamped with
 * effective_from; a document uses the config that was effective ON ITS DATE,
 * so a rate change never recalculates an issued document.
 */
export function resolveProfile(profile: GstProfileId | null | undefined) {
  if (!profile) return null;
  return REGULAR_PROFILES[profile] ?? null;
}

/** Statutory reference a GST invoice must be able to cite. */
export function profileNotification(profile: GstProfileId): string {
  return REGULAR_PROFILES[profile].notification;
}
