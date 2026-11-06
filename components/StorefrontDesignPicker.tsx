'use client';

/**
 * The storefront design section's interactive half.
 *
 * The same two cards the import offered at the end of the journey, now open
 * for the life of the storefront — each card a live preview painted by the
 * guest's own paint functions over this restaurant's dishes. The apply is a
 * plain form post: pick a design, press Apply, and the server decides
 * whether that is a draft save or an instant, rollbackable switch.
 */

import { useState } from 'react';
import { DesignChooser } from '@/components/screens/DesignChooser';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { applyDesignAction } from '@/app/(staff)/dashboard/menus/brand-actions';
import type { DesignCandidate, DesignId } from '@/lib/branding/designs';

export function StorefrontDesignPicker({
  designs,
  currentDesignId,
  name,
  logoUrl,
  bannerUrl,
  dishes,
  published,
  canEdit,
}: {
  designs: DesignCandidate[];
  currentDesignId: DesignId | null;
  name: string;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  dishes: { category: string; name: string; pricePaise: number }[];
  /** Is a menu live? Decides whether Apply switches instantly or saves a draft. */
  published: boolean;
  canEdit: boolean;
}) {
  // Start on the live design, so the owner sees what guests see now; clicking
  // the other card is what enables the switch.
  const [selected, setSelected] = useState<DesignId | null>(currentDesignId);

  const alreadyLive = selected !== null && selected === currentDesignId;
  const disabled = !canEdit || selected === null || alreadyLive;

  return (
    <form action={applyDesignAction}>
      <input type="hidden" name="designId" value={selected ?? ''} />
      <DesignChooser
        designs={designs}
        selectedId={selected}
        onSelect={setSelected}
        disabled={disabled}
        name={name}
        logoUrl={logoUrl}
        bannerUrl={bannerUrl}
        dishes={dishes}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel={published ? 'Applying…' : 'Saving…'} disabled={disabled}>
          {alreadyLive
            ? published
              ? 'This design is live'
              : 'Saved to your draft'
            : published
              ? 'Apply design'
              : 'Save to draft'}
        </SubmitButton>
        <span className="text-[11.5px] text-gink-46">
          {published
            ? 'Switching is instant. The previous design can come back from Publish history.'
            : 'Saved to your draft — it goes live with your first publish.'}
        </span>
      </div>
      {!canEdit && (
        <p className="m-0 mt-2 text-[11.5px] text-gink-46">
          Only an owner or manager can change the design.
        </p>
      )}
    </form>
  );
}
