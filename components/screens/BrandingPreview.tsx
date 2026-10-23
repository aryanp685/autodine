import Link from 'next/link';
import { MenuIdentity } from '@/components/MenuIdentity';
import { DishPhoto } from '@/components/DishPhoto';
import { SignInPrompt } from '@/components/SignInPrompt';
import type { BrandingScreenData } from '@/lib/db/branding-screen';
import type { MenuScreenData } from '@/lib/db/menu-screen';
import { accentFrom } from '@/lib/branding/palette';
import { inr } from '@/lib/demo-data';

/**
 * The guest menu, in an owner's browser, with a toolbar that says so.
 *
 * Deliberately NOT the real CustomerMenu component: that one is a client
 * component wired to a cart, a session and a table, and mounting it here would
 * either need all of that faked or would start writing cart lines from a
 * preview. What it shares instead is the part that actually changes --
 * `MenuIdentity` -- plus the dish rows, so the preview cannot disagree with
 * the product about the thing being previewed.
 *
 * The toolbar is the honest bit: it says "Preview" and names the table as a
 * sample, so nobody mistakes the badge for a real verification.
 */
export function BrandingPreview({
  data,
  menu,
  backHref,
}: {
  data: BrandingScreenData | null;
  menu: MenuScreenData | null;
  backHref: string;
}) {
  if (data?.blocked) {
    return (
      <div className="pg pg--dash" data-surface="owner">
        <div className="pg__body">
          <SignInPrompt reason={data.blocked} screen="menu preview" />
        </div>
      </div>
    );
  }

  const accent = accentFrom(data?.accent);
  const restaurant = menu?.restaurant;
  const name = restaurant?.name ?? data?.name ?? 'Your restaurant';

  return (
    <div
      className="brandPreview"
      style={{ ['--p-accent' as string]: accent.accent, ['--p-accent-soft' as string]: accent.soft }}
    >
      <header className="brandPreview__bar">
        <Link href={backHref} className="brandPreview__back">
          ← Branding
        </Link>
        <span className="brandPreview__tag">Preview</span>
        <span className="brandPreview__hint">Guests see this after scanning. The table badge is a sample.</span>
      </header>

      <div className="brandPreview__stage">
        <div className="brandPreview__phone">
          <MenuIdentity
            name={name}
            tagline={restaurant?.tagline}
            address={restaurant?.address}
            logoUrl={restaurant?.logoUrl ?? data?.logoUrl}
            bannerUrl={restaurant?.bannerUrl ?? data?.bannerUrl}
            tableLabel="Table 7"
          />

          {menu && menu.categories.length > 0 && (
            <nav className="brandPreview__cats" aria-label="Courses (preview)">
              <span className="brandPreview__cat is-on">All</span>
              {menu.categories.slice(0, 4).map((c) => (
                <span key={c.id} className="brandPreview__cat">
                  {c.name}
                </span>
              ))}
            </nav>
          )}

          <div className="brandPreview__list">
            {menu?.items.slice(0, 8).map((item) => (
              <article key={item.id} className={`brandPreview__row ${item.available ? '' : 'is-out'}`}>
                <div className="brandPreview__rowBody">
                  <div className="brandPreview__rowName">{item.name}</div>
                  {item.desc && <div className="brandPreview__rowDesc">{item.desc}</div>}
                  <div className="brandPreview__rowPrice tnum">{inr(item.price)}</div>
                </div>
                <DishPhoto src={item.img} name={item.name} size={72} className="brandPreview__rowImg" />
                <span className="brandPreview__add" aria-hidden="true">
                  +
                </span>
              </article>
            ))}

            {(!menu || menu.items.length === 0) && (
              <div className="brandPreview__empty">
                <strong>No dishes yet.</strong>
                <p>Add dishes in Menus and they will appear here, with your branding around them.</p>
                <Link href="/dashboard/menus" className="brandPreview__cta">
                  Go to Menus
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
