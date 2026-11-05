'use client';

import { MenuIdentity } from '@/components/MenuIdentity';
import type { DesignCandidate, DesignId } from '@/lib/branding/designs';
import { themeDataAttrs, themeGuestStyle } from '@/lib/branding/theme';
import { inr } from '@/lib/demo-data';
import { btn } from '@/components/owner/chrome';

/**
 * Choose your storefront design — step 3 of the import journey.
 *
 * Each card is a live preview painted by the SAME functions the guest menu
 * paints with (themeGuestStyle + themeDataAttrs around the real MenuIdentity)
 * and showing the owner's actual extracted dishes. A preview that used a
 * mock-up here would be a preview that could disagree with the product.
 *
 * The choice is optional: with no pick, the save keeps the extracted style as
 * it always has. Nothing here writes — the parent folds the pick into its one
 * Create.
 */
export function DesignChooser({
  designs,
  selectedId,
  onSelect,
  name,
  logoUrl,
  bannerUrl,
  dishes,
}: {
  designs: DesignCandidate[];
  selectedId: DesignId | null;
  onSelect: (id: DesignId) => void;
  name: string;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  /** The real extracted rows: name and price as the draft will save them. */
  dishes: { category: string; name: string; pricePaise: number }[];
}) {
  return (
    <section
      data-design-chooser
      aria-label="Choose your storefront design"
      className="mt-4 rounded-[14px] border border-hair bg-paper px-4 py-4 sm:px-5"
    >
      <h2 className="m-0 text-[13px] font-semibold text-gink">Choose your design</h2>
      <p className="mt-1 mb-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
        Two styles built from your menu&apos;s own brand — your name, your colours, your dishes. This
        is what guests see after scanning. You can change it later in Branding.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {designs.map((design) => {
          const selected = design.id === selectedId;
          return (
            <div
              key={design.id}
              data-design={design.id}
              data-selected={selected ? 'true' : undefined}
              className={[
                'rounded-[12px] p-2.5 transition-colors duration-150',
                selected ? 'border-2 border-plum bg-plum-soft' : 'border border-hair',
              ].join(' ')}
            >
              {/* The live mini-storefront: the guest renderer, painted from
                  this candidate's theme around the real extracted data. */}
              <div
                data-flow-root=""
                style={themeGuestStyle(design.theme) as React.CSSProperties}
                {...themeDataAttrs(design.theme)}
                className="overflow-hidden rounded-[10px] border border-hair"
              >
                <MenuIdentity
                  name={name}
                  logoUrl={logoUrl}
                  bannerUrl={bannerUrl}
                  headerStyle={design.theme.layout.header}
                />
                <div className="px-3 pb-3">
                  {dishes.slice(0, 3).map((dish, index) => (
                    <div
                      key={`${dish.category}-${dish.name}-${index}`}
                      className="flex items-baseline justify-between gap-2 border-b border-hair py-2 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[11.5px] font-medium text-gink">{dish.name}</div>
                        <div className="text-[10px] text-gink-46">{dish.category}</div>
                      </div>
                      <div className="shrink-0 text-[11.5px] tabular-nums text-gink">
                        {inr(Math.round(dish.pricePaise / 100))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-gink">
                    {design.name}
                    {selected && (
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3.5 text-plum">
                        <path
                          d="M3 8.5L6.5 12L13 4.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </p>
                  <p className="m-0 text-[11.5px] leading-[1.45] text-gink-46">{design.tagline}</p>
                </div>
                <button
                  type="button"
                  className={btn(selected ? 'quiet' : 'ghost', 'sm')}
                  aria-pressed={selected}
                  onClick={() => onSelect(design.id)}
                >
                  {selected ? 'Selected' : 'Choose'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
