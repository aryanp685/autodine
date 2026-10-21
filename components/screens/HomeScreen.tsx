import Image from 'next/image';
import Link from 'next/link';
import { inr, plans } from '@/lib/demo-data';

const experience = [
  {
    number: '01',
    title: 'A menu made for the table',
    body: 'Browse a sample menu or view a restaurant menu when one is configured. Menu editing and publishing are still previews.',
  },
  {
    number: '02',
    title: 'A clearer path to an order',
    body: 'Guests can use a table QR to submit an unpaid order in a connected test workspace. Hosted end-to-end ordering still needs verification.',
  },
  {
    number: '03',
    title: 'Thoughtful tools for the team',
    body: 'Explore table, QR and cashier previews. Online payments, subscriptions and the live kitchen board are not enabled.',
  },
];

const serviceDetails = [
  ['For guests', 'A browser-based menu; no app install needed'],
  ['At the table', 'Secure, revocable QR sessions'],
  ['At the counter', 'An early cash-collection test path'],
];

export function Home() {
  return (
    <div className="home home--premium">
      <nav className="home__nav home__nav--premium" aria-label="Main navigation">
        <Link href="/" className="home__brand" aria-label="AutoDine home">
          <span className="home__brandMark" aria-hidden="true">A</span>
          <span>AutoDine</span>
        </Link>
        <ul className="home__links">
          <li><a href="#product">Experience</a></li>
          <li><Link href="/pricing">Pricing preview</Link></li>
          <li><Link href="/menu">Menu demo</Link></li>
        </ul>
        <div className="home__navRight">
          <Link href="/login" className="home__navLink">Sign in</Link>
          <Link href="/signup" className="home__navCta">Create account <span aria-hidden="true">↗</span></Link>
        </div>
      </nav>

      <header className="home__hero home__hero--premium">
        <Image className="home__heroImg" src="/img/restaurant-interior.jpg" alt="Warmly lit restaurant dining room" fill priority sizes="100vw" />
        <div className="home__heroShade" />
        <div className="home__heroBody home__heroBody--premium">
          <div className="home__kicker"><span className="home__kickerDot" /> Restaurant QR ordering · product preview</div>
          <h1 className="home__h1 home__h1--premium">
            <span>Better dining</span>
            <span>begins at the table.</span>
          </h1>
          <p className="home__lede home__lede--premium">
            Explore a considered QR menu and the restaurant workflows taking shape around it. Start with the sample menu, then see how the team tools fit together.
          </p>
          <div className="home__ctas home__ctas--premium">
            <Link href="/signup" className="home__btn home__btn--solid">Create an account <span aria-hidden="true">↗</span></Link>
            <Link href="/menu" className="home__btn home__btn--line">Explore the menu</Link>
          </div>
          <div className="home__note home__note--premium">
            <span className="home__noteMark" aria-hidden="true">i</span>
            <span>Preview only. Connected test workspaces can accept unpaid counter orders. Online payments and subscriptions are not enabled; the hosted order-to-kitchen flow is not verified.</span>
          </div>
          <a className="home__scrollCue" href="#product">Discover the experience <span aria-hidden="true">↓</span></a>
        </div>
        <div className="home__heroIndex" aria-hidden="true"><span>01</span><i /> PRODUCT PREVIEW</div>
      </header>

      <main>
        <section className="home__section home__section--premium" id="product" aria-labelledby="home-experience-title">
          <div className="home__sectionIntro">
            <div>
              <div className="home__sectionEyebrow">THE EXPERIENCE</div>
              <h2 className="home__sectionTitle" id="home-experience-title">Thoughtful from the first scan.</h2>
            </div>
            <p className="home__sectionLead">A focused look at how digital menus and restaurant service can work together—without losing the human touch.</p>
          </div>
          <div className="home__three home__three--premium">
            {experience.map((item) => (
              <article key={item.number} className="home__col home__col--premium">
                <div className="home__num">{item.number}</div>
                <h3 className="home__colTitle">{item.title}</h3>
                <p className="home__colBody">{item.body}</p>
                <span className="home__colRule" aria-hidden="true" />
              </article>
            ))}
          </div>
        </section>

        <section className="home__band home__band--premium" aria-label="Product preview details">
          <div className="home__bandIntro">
            <div className="home__sectionEyebrow">BUILT AROUND SERVICE</div>
            <h2>Simple for the guest.<br />Clear for the team.</h2>
          </div>
          <div className="home__bandInner home__bandInner--premium">
            {serviceDetails.map(([title, detail], index) => (
              <div key={title} className="home__stat home__stat--premium">
                <span className="home__statIndex">0{index + 1}</span>
                <div className="home__statValue">{title}</div>
                <div className="home__statLabel">{detail}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="home__section home__section--plans" aria-labelledby="home-plans-title">
          <div className="home__sectionIntro home__sectionIntro--plans">
            <div>
              <div className="home__sectionEyebrow">A LOOK AHEAD</div>
              <h2 className="home__h2" id="home-plans-title">Pricing preview</h2>
            </div>
            <p className="home__sectionLead">Illustrative plans only. Subscription billing is not enabled in this preview.</p>
          </div>
          <div className="home__plans home__plans--premium">
            {plans.map((plan, index) => (
              <article key={plan.id} className={`home__plan home__plan--premium ${index === 1 ? 'is-featured' : ''}`}>
                <div className="home__planTopline"><span>{plan.name}</span><span>0{index + 1}</span></div>
                <div className="home__planPrice">
                  {inr(plan.price)}<span>/ month · illustrative</span>
                </div>
                <p className="home__planBlurb">{plan.blurb}</p>
                <ul className="home__planList">
                  {plan.features.slice(0, 5).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Link href="/pricing" className="home__planLink">View pricing preview <span aria-hidden="true">→</span></Link>
              </article>
            ))}
          </div>
          <p className="home__fine home__fine--premium">
            Names, prices and feature lists are sample content—not an offer. Trial controls exist; paid subscriptions, billing and reactivation are not connected.
          </p>
        </section>
      </main>

      <footer className="home__foot home__foot--premium">
        <div className="home__footTop">
          <Link href="/" className="home__footBrand"><span className="home__brandMark" aria-hidden="true">A</span> AutoDine</Link>
          <p>Restaurant service, thoughtfully connected.</p>
        </div>
        <div className="home__footCols home__footCols--premium">
          <div>
            <div className="home__footTitle">Explore</div>
            <p><Link href="/#product">Experience</Link> · <Link href="/pricing">Pricing preview</Link> · <Link href="/menu">Menu demo</Link></p>
          </div>
          <div>
            <div className="home__footTitle">Preview scope</div>
            <p>Demo content is fictional. Ordering and cash collection are test paths; online payments and the live kitchen flow are not enabled.</p>
          </div>
          <div>
            <div className="home__footTitle">Your account</div>
            <p><Link href="/login">Sign in</Link> · <Link href="/signup">Create account</Link></p>
          </div>
        </div>
        <div className="home__footFine">AutoDine · Product preview · not for live restaurant operations</div>
      </footer>
    </div>
  );
}
