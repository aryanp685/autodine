import Link from 'next/link';
import { MenuIdentity } from '@/components/MenuIdentity';
import { DishPhoto } from '@/components/DishPhoto';
import { SignInPrompt } from '@/components/SignInPrompt';
import type { BrandingScreenData } from '@/lib/db/branding-screen';
import type { MenuScreenData } from '@/lib/db/menu-screen';
import { accentFrom } from '@/lib/branding/palette';
import { inr } from '@/lib/demo-data';
import { btn } from '@/components/owner/chrome';

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
      <div
        data-surface="owner"
        className="min-h-dvh bg-paper px-5 py-10 text-gink antialiased sm:py-16"
      >
        <div className="mx-auto w-full max-w-[460px]">
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
      // The accent belongs to the previewed restaurant, not to the staff
      // surface around it, so it is set here and nowhere higher.
      style={
        {
          ['--p-accent' as string]: accent.accent,
          ['--p-accent-soft' as string]: accent.soft,
        } as React.CSSProperties
      }
      className="min-h-dvh bg-paper-deep text-gink antialiased"
    >
      <header className="sticky top-0 z-10 border-b border-hair bg-paper/92 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-2.5 px-5 py-3">
          <Link href={backHref} className={`${btn('quiet', 'sm')} -ml-2`}>
            ← Branding
          </Link>
          <span className="inline-flex h-6 items-center rounded-full bg-gink px-2.5 text-[10.5px] font-semibold tracking-[0.06em] text-onink uppercase">
            Preview
          </span>
          <span className="text-[11.5px] text-gink-46">
            Guests see this after scanning. The table badge is a sample.
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[760px] justify-center px-5 py-7">
        {/* The phone. Same width as the editor preview, so switching between
            the two does not reflow the header. */}
        <div className="w-full max-w-[360px] overflow-hidden rounded-[22px] border border-hair-strong bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_18px_40px_-24px_rgba(0,0,0,0.28)]">
          <MenuIdentity
            name={name}
            tagline={restaurant?.tagline}
            address={restaurant?.address}
            logoUrl={restaurant?.logoUrl ?? data?.logoUrl}
            bannerUrl={restaurant?.bannerUrl ?? data?.bannerUrl}
            tableLabel="Table 7"
          />

          {menu && menu.categories.length > 0 && (
            <nav aria-label="Courses (preview)" className="flex gap-1.5 overflow-x-auto px-4 py-3">
              <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-gink px-3 text-[11.5px] font-medium text-onink">
                All
              </span>
              {menu.categories.slice(0, 4).map((c) => (
                <span
                  key={c.id}
                  className="inline-flex h-7 shrink-0 items-center rounded-full border border-hair-strong px-3 text-[11.5px] text-gink-64"
                >
                  {c.name}
                </span>
              ))}
            </nav>
          )}

          <div className="px-4 pb-4">
            {menu?.items.slice(0, 8).map((item) => (
              <article
                key={item.id}
                data-out={item.available ? undefined : 'true'}
                className={[
                  'flex items-start gap-3 border-b border-hair py-3 last:border-b-0',
                  item.available ? '' : 'opacity-45',
                ].join(' ')}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-gink">{item.name}</div>
                  {item.desc && (
                    <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-[1.45] text-gink-46">
                      {item.desc}
                    </div>
                  )}
                  <div className="mt-1 text-[12.5px] text-gink tabular-nums">{inr(item.price)}</div>
                </div>
                <DishPhoto src={item.img} name={item.name} size={64} />
                <span
                  aria-hidden="true"
                  className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--p-accent)] text-[15px] leading-none text-white"
                >
                  +
                </span>
              </article>
            ))}

            {(!menu || menu.items.length === 0) && (
              <div className="rounded-[12px] border border-dashed border-hair-strong px-4 py-8 text-center">
                <strong className="text-[12.5px] font-medium text-gink">No dishes yet.</strong>
                <p className="mt-1 text-[11.5px] leading-[1.5] text-gink-46">
                  Add dishes in Menus and they will appear here, with your branding around them.
                </p>
                <Link href="/dashboard/menus" className={`${btn('solid', 'sm')} mt-3`}>
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
