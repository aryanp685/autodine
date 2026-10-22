import { categories, inr, items, restaurant } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';

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
    <div className="menu smenu">
      <header className="menu__head">
        <div className="menu__venue">
          <div className="menu__kicker">Sample menu</div>
          <h1 className="menu__venueName">{restaurant.name}</h1>
          <div className="menu__venueMeta">{restaurant.tagline}</div>
        </div>
        <div className="menu__verified smenu__badge">
          <span className="menu__verifiedDot" />
          Preview · no ordering
        </div>
      </header>

      <div className="smenu__body">
        {sections.map((section, index) => (
          <section key={section.id} className="smenu__sect" aria-labelledby={`s-${section.id}`}>
            <div className="smenu__sectHead">
              <span className="smenu__sectNum">{String(index + 1).padStart(2, '0')}</span>
              <h2 className="smenu__sectName" id={`s-${section.id}`}>
                {section.name}
              </h2>
              <span className="smenu__sectCount">
                {section.dishes.length} {section.dishes.length === 1 ? 'dish' : 'dishes'}
              </span>
            </div>

            <div className="smenu__rows">
              {section.dishes.map((dish) => (
                <article
                  key={dish.id}
                  className={`smenu__row${dish.available ? '' : ' is-out'}`}
                >
                  <div className="smenu__line">
                    <span className="smenu__mark">
                      <VegMark veg={dish.veg} size={12} />
                    </span>
                    <h3 className="smenu__name">{dish.name}</h3>
                    {!dish.available && <span className="smenu__out">Sold out</span>}
                    <span className="smenu__dots" aria-hidden="true" />
                    <span className="smenu__price tnum">{inr(dish.price)}</span>
                  </div>
                  <p className="smenu__desc">{dish.desc}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="smenu__foot">
        <p className="smenu__note">
          A sample of the menu your guests would read — priced in rupees, priced by the kitchen,
          and the same list the counter bills from.
        </p>
        <p className="smenu__fine">
          Sample content. AutoDine is a product preview; nothing here is for sale and no order can
          be placed from this page.
        </p>
      </div>
    </div>
  );
}
