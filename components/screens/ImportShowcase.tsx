/**
 * The menu-to-storefront showcase that sits beside the import hero.
 *
 * A demonstration, not a product surface: a printed menu card pointing at a
 * phone showing a sample storefront. Every pixel is CSS on the design
 * system's own tokens — no stock images, no gradients (the staff surface is
 * flat paper), and the sample identity is labelled as a sample so nothing
 * here can be mistaken for real guest data.
 */

const SAMPLE_ROWS = [
  { section: 'Starters' },
  { name: 'Paneer Tikka', price: '₹249' },
  { name: 'Chicken Wings', price: '₹299' },
  { section: 'Main Course' },
  { name: 'Butter Chicken', price: '₹399' },
  { name: 'Veg Biryani', price: '₹299' },
];

const SAMPLE_CHIPS = ['All', 'Starters', 'Mains', 'Biryani'];

export function ImportShowcase() {
  return (
    <section aria-label="What the import builds" className="min-w-0">
      <div className="flex min-w-0 items-center justify-center gap-3 sm:gap-4">
        {/* The paper menu. Hidden on the smallest screens, where the phone
            alone says the same thing without crowding the upload card. */}
        <div className="hidden min-w-0 flex-1 flex-col sm:flex">
          <div className="rounded-[14px] border border-hair bg-ink-card p-3">
            <p className="m-0 text-center text-[11.5px] font-semibold tracking-[0.22em] text-gink">
              MENU
            </p>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {SAMPLE_ROWS.map((row) =>
                'section' in row ? (
                  <p
                    key={row.section}
                    className="m-0 pt-1 text-[10px] font-semibold tracking-[0.09em] text-gink-46 uppercase"
                  >
                    {row.section}
                  </p>
                ) : (
                  <div
                    key={row.name}
                    className="flex items-baseline justify-between gap-2 text-[10.5px] text-gink-64"
                  >
                    <span className="min-w-0 truncate">{row.name}</span>
                    <span aria-hidden="true" className="min-w-0 flex-1 border-b border-hair" />
                    <span className="tabular-nums text-gink">{row.price}</span>
                  </div>
                )
              )}
            </div>
            <div aria-hidden="true" className="mt-2.5 flex gap-1.5">
              <div className="h-9 flex-1 rounded-[8px] bg-plum-soft" />
              <div className="h-9 flex-1 rounded-[8px] bg-ink-soft" />
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gink-46">Your existing menu</p>
        </div>

        {/* The transformation arrow. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 56 40"
          className="hidden h-9 w-12 shrink-0 text-plum md:block"
          fill="none"
        >
          <path
            d="M4 30C16 12 34 8 48 13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M42 6.5L49 13.5L41 17.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* The sample storefront on a phone. */}
        <div className="flex w-[186px] shrink-0 flex-col items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-plum-soft px-2.5 py-1 text-[10px] font-semibold text-plum">
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3" fill="none">
              <path
                d="M3 8.5L6.5 12L13 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Your Branded Storefront
          </span>
          <div className="w-full rounded-[18px] border border-hair bg-ink-card p-2">
            <div className="rounded-[12px] bg-gink px-3 py-3 text-onink">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="grid size-5 place-items-center rounded-full bg-plum-soft text-[10px] font-semibold text-plum"
                >
                  C
                </span>
                <div className="min-w-0">
                  <p className="m-0 truncate text-[11.5px] font-semibold">The Courtyard</p>
                  <p className="m-0 text-[10px]">Café &amp; Bistro</p>
                </div>
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              {SAMPLE_CHIPS.map((chip, index) => (
                <span
                  key={chip}
                  className={[
                    'rounded-full px-2 py-0.5 text-[10px]',
                    index === 0 ? 'bg-plum font-semibold text-onink' : 'border border-hair text-gink-46',
                  ].join(' ')}
                >
                  {chip}
                </span>
              ))}
            </div>
            <div className="mt-2 flex items-start gap-2">
              <div aria-hidden="true" className="h-11 w-12 shrink-0 rounded-[8px] bg-plum-soft" />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[10.5px] font-semibold text-gink">Paneer Tikka</p>
                <p className="m-0 text-[10px] leading-[1.35] text-gink-46">
                  Grilled cottage cheese with spices.
                </p>
                <div className="mt-1 flex items-center justify-between gap-1.5">
                  <span className="text-[11.5px] font-semibold tabular-nums text-gink">₹249</span>
                  <span className="rounded-full bg-grass px-2 py-0.5 text-[10px] font-medium text-cream">
                    + Add
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-[10px] text-gink-28">
        Sample preview — your own name and photos replace this.
      </p>
    </section>
  );
}
