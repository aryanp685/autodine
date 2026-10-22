import { inr } from '@/lib/demo-data';

/* ============================================================================
   The product tour

   WHY THIS REPLACED THE SAMPLE-MENU LINK

   The marketing pages used to hand visitors a sandbox: "see a sample menu",
   pointed at /demo/menu, which renders the guest screen with invented dishes.
   Two problems with that. It is a detour at the exact moment somebody is
   deciding whether to care, and a sandbox is not proof -- anybody can mock up
   a menu. Meanwhile the real screens existed and were never shown.

   This section shows them. Three panels, in the order a service moves through
   them, rendered at scale in the page itself: the guest's menu, the kitchen's
   board, the counter's settlement. They are markup, not screenshots, so they
   stay sharp at any size, cost one HTML payload instead of three images, and
   cannot go stale the way a screenshot does.

   On a wide screen the panels stack in a sticky frame and cross-fade as each
   step scrolls past (see SiteMotion). On a phone they simply read beneath
   their step. With no JavaScript at all, every panel is visible: the CSS only
   switches to the stacked arrangement once the motion layer has said it is
   ready, so nothing is ever hidden by a script that failed to load.
   ========================================================================== */

const STEPS: Array<{
  n: string;
  title: string;
  body: string;
  notes: [string, string];
}> = [
  {
    n: '01',
    title: 'The guest’s phone',
    body: 'A card on the table opens this table’s menu and nothing else. Dishes are grouped the way the room is, a portion is chosen in a sheet, and the order goes in one tap.',
    notes: ['Opens only at a live table', 'No app, no account to create'],
  },
  {
    n: '02',
    title: 'The kitchen board',
    body: 'The ticket lands in the same second, already ordered by what needs cooking next. The board reads new tickets aloud in Hindi while the room is loud.',
    notes: ['Spoken aloud, not just listed', 'Ages colour as a ticket gets late'],
  },
  {
    n: '03',
    title: 'The counter',
    body: 'Billed and collected stay two separate numbers. Cash, card or UPI is recorded against the bill and a receipt prints from the same browser.',
    notes: ['Nothing is charged by the software', 'Every settlement is written down'],
  },
];

/** The three fragments. Re-rendered UI, not screenshots. */
function GuestPanel() {
  return (
    <div className="tour__sheet tour__sheet--menu">
      <div className="tour__sheetHead">
        <p className="tour__sheetKicker">The menu</p>
        <p className="tour__venue">Saffron &amp; Smoke</p>
        <p className="tour__venueMeta">North Indian · dine-in</p>
      </div>

      <div className="tour__cats" aria-hidden="true">
        <span className="tour__cat is-on">Starters</span>
        <span className="tour__cat">Mains</span>
        <span className="tour__cat">Breads</span>
        <span className="tour__cat">Sweet</span>
      </div>

      <div className="tour__dishes">
        <div className="tour__dish">
          <div>
            <p className="tour__dishName">Butter Chicken</p>
            <p className="tour__dishDesc">Tandoori chicken, tomato and cream, finished with butter.</p>
            <p className="tour__dishFoot">
              <span className="tour__price tnum">{inr(469)}</span>
              <span className="tour__add">Add</span>
            </p>
          </div>
        </div>
        <div className="tour__dish">
          <div>
            <p className="tour__dishName">Garlic Naan</p>
            <p className="tour__dishDesc">Leavened bread, brushed with garlic butter.</p>
            <p className="tour__dishFoot">
              <span className="tour__price tnum">{inr(89)}</span>
              <span className="tour__add">Add</span>
            </p>
          </div>
        </div>
      </div>

      <div className="tour__cartBar">
        <span>
          <strong className="tnum">2</strong> items · <span className="tnum">{inr(776)}</span>
        </span>
        <span className="tour__cartBtn">Review order</span>
      </div>
    </div>
  );
}

function KitchenPanel() {
  return (
    <div className="tour__sheet tour__sheet--kitchen">
      <div className="tour__sheetHead tour__sheetHead--row">
        <div>
          <p className="tour__sheetKicker">Kitchen · live</p>
          <p className="tour__venue">Saffron &amp; Smoke</p>
        </div>
        <span className="tour__pillChar">हिंदी · तैयार</span>
      </div>

      <div className="tour__ticket">
        <div className="tour__ticketTop">
          <span className="tour__tableNo">T7</span>
          <span className="tour__ticketCode">A-1042 · 12:42 PM</span>
          <span className="tour__age">4 min</span>
        </div>
        <ul className="tour__ticketItems">
          <li>
            <span className="tnum">2×</span> Butter Chicken <em>· Half</em>
          </li>
          <li>
            <span className="tnum">3×</span> Garlic Naan
          </li>
          <li>
            <span className="tnum">1×</span> Mango Lassi
          </li>
        </ul>
        <p className="tour__ticketNote">“no onion in the gravy”</p>
        <div className="tour__ticketFoot">
          <span className="tour__ticketTotal tnum">{inr(1247)}</span>
          <span className="tour__act">Start preparing</span>
        </div>
      </div>

      <div className="tour__ticket tour__ticket--quiet" aria-hidden="true">
        <div className="tour__ticketTop">
          <span className="tour__tableNo">T3</span>
          <span className="tour__ticketCode">A-1041</span>
          <span className="tour__age tour__age--quiet">9 min</span>
        </div>
        <p className="tour__ticketLine">Preparing · 1× Subz Dum Biryani</p>
      </div>
    </div>
  );
}

function CounterPanel() {
  return (
    <div className="tour__sheet tour__sheet--counter">
      <div className="tour__sheetHead tour__sheetHead--row">
        <div>
          <p className="tour__sheetKicker">Counter</p>
          <p className="tour__venue">Order A-1042 · T7</p>
        </div>
        <span className="tour__due">Payment due</span>
      </div>

      <p className="tour__amount tnum">{inr(776)}</p>

      <div className="tour__lines">
        <p>
          <span>Butter Chicken · 2</span>
          <span className="tnum">{inr(938)}</span>
        </p>
        <p>
          <span>Garlic Naan · 3</span>
          <span className="tnum">{inr(267)}</span>
        </p>
        <p className="tour__linesTotal">
          <span>Outstanding</span>
          <span className="tnum">{inr(776)}</span>
        </p>
      </div>

      <div className="tour__methods" aria-hidden="true">
        <span className="is-on">Cash</span>
        <span>Card</span>
        <span>UPI</span>
      </div>

      <p className="tour__cta">Record cash {inr(776)}</p>
      <p className="tour__fine">
        Writes the record. No terminal or payment provider is contacted.
      </p>
    </div>
  );
}

export function ProductTour() {
  return (
    <section className="p-sect p-sect--tight tour" id="tour">
      <div className="p-wrap">
        <div className="p-head" data-reveal>
          <div>
            <div className="p-eyebrow">03 · The screens</div>
            <h2 className="p-h2 p-head__title">Three screens, in service order.</h2>
          </div>
          <p className="p-lede p-head__aside">
            Not a screenshot and not a sandbox: these are the product’s own layouts, rendered here
            at scale. A guest orders, the kitchen reads it, the counter settles it.
          </p>
        </div>

        <div className="tour__stage" data-tour>
          <div className="tour__steps">
            {STEPS.map((step) => (
              <article key={step.n} className="tour__step" data-tour-step>
                <p className="tour__num">{step.n}</p>
                <h3 className="p-h3 tour__title">{step.title}</h3>
                <p className="p-body tour__body">{step.body}</p>
                <ul className="tour__notes">
                  {step.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          {/* Decorative: the same information is in the steps beside them, so
              a screen reader is not read a fake ticket. */}
          <div className="tour__panels" aria-hidden="true">
            <div className="tour__panel" data-tour-panel>
              <GuestPanel />
            </div>
            <div className="tour__panel" data-tour-panel>
              <KitchenPanel />
            </div>
            <div className="tour__panel" data-tour-panel>
              <CounterPanel />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
