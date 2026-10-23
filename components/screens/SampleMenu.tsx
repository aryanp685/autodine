import { categories, inr, items, restaurant } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { DishPhoto } from '@/components/DishPhoto';

/* ============================================================================
   A public sample of the guest menu.

   Read-only on purpose. It is the same type, hairlines and palette as the real
   /menu, set the way a printed menu is set: a section heading, then rows whose
   name and price are joined by a dotted leader. Prices line up on the right
   edge, which is the whole reason a menu reads quickly.

   No "Add" anywhere: an order needs a verified table, and a button here that
   could not place one would be a lie with a border around it.
   ========================================================================== */

export function SampleMenu() {
  // Only sections that actually have dishes; the demo data carries counts as
  // well, but a heading over an empty list is worse than no heading.
  const sections = categories
    .map((category) => ({
      ...category,
      dishes: items.filter((item) => item.category === category.id),
    }))
    .filter((section) => section.dishes.length > 0);

  return (
    <div className="min-h-dvh bg-paper text-gink">
      <header className="border-b border-hair px-5 pt-8 pb-6">
        <div className="mx-auto w-full max-w-[720px]">
          <p className="text-[10.5px] font-semibold tracking-[0.13em] text-gink-46 uppercase">Sample menu</p>
          <h1 className="mt-2 text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] text-gink">
            {restaurant.name}
          </h1>
          <p className="mt-1.5 text-[12px] tracking-[0.05em] text-gink-46">{restaurant.tagline}</p>

          {/* Said at the top, in the place a status would go, because the whole
              page is a preview and a guest must not try to order from it. */}
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.07em] text-[var(--p-accent)] uppercase">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--p-accent)]" />
            Preview · no ordering
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[720px] px-5 pt-8 pb-4">
        {sections.map((section, index) => (
          <section key={section.id} aria-labelledby={`s-${section.id}`} className="mb-8">
            <div className="flex items-baseline gap-2.5 border-b border-hair pb-2">
              <span className="tnum text-[10.5px] font-semibold tracking-[0.09em] text-gink-46">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h2
                id={`s-${section.id}`}
                className="text-[12px] font-semibold tracking-[0.11em] text-gink uppercase"
              >
                {section.name}
              </h2>
              <span className="tnum ml-auto text-[11px] text-gink-46">
                {section.dishes.length} {section.dishes.length === 1 ? 'dish' : 'dishes'}
              </span>
            </div>

            <div>
              {section.dishes.map((dish) => (
                <article
                  key={dish.id}
                  className={[
                    'flex items-start gap-3 border-b border-hair py-3.5 last:border-b-0',
                    dish.available ? '' : 'opacity-55',
                  ].join(' ')}
                >
                  {/* A photograph per dish, the same tile the real menu uses.
                      The sample is meant to show the product, and a menu of
                      prices with no pictures is not what a guest sees. */}
                  <DishPhoto src={dish.img} name={dish.name} size={56} className="size-14" />

                  <div className="min-w-0 flex-1">
                    {/* Name and price joined by a dotted leader, the way a
                        printed menu does it: the eye travels along the dots
                        rather than across a gap of white. */}
                    <div className="flex items-baseline gap-2">
                      <span className="mt-0.5 shrink-0">
                        <VegMark veg={dish.veg} size={12} />
                      </span>
                      <h3 className="shrink-0 text-[15px] font-semibold tracking-[-0.01em] text-gink">
                        {dish.name}
                      </h3>
                      {!dish.available && (
                        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-gink-46 uppercase">
                          Sold out
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        className="mx-1 h-px min-w-4 flex-1 self-center border-b border-dotted border-gink-28"
                      />
                      <span className="tnum shrink-0 text-[14.5px] font-semibold text-gink">
                        {inr(dish.price)}
                      </span>
                    </div>
                    <p className="mt-1 max-w-[52ch] text-[12.5px] leading-[1.5] text-gink-64">{dish.desc}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="mx-auto w-full max-w-[720px] px-5 pb-14">
        <hr className="mb-4 border-hair" />
        <p className="max-w-[56ch] text-[12.5px] leading-[1.6] text-gink-64">
          A sample of the menu your guests would read — priced in rupees, priced by the kitchen,
          and the same list the counter bills from.
        </p>
        <p className="mt-2 max-w-[56ch] text-[11.5px] leading-[1.6] text-gink-46">
          Sample content. AutoDine is a product preview; nothing here is for sale and no order can
          be placed from this page.
        </p>
      </footer>
    </div>
  );
}
