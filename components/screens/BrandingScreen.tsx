import Link from 'next/link';
import Image from 'next/image';
import { SignInPrompt } from '@/components/SignInPrompt';
import { MenuIdentity } from '@/components/MenuIdentity';
import type { OutletBar } from '@/lib/outlets';
import type { BrandingScreenData } from '@/lib/db/branding-screen';
import { guestAccentStyle } from '@/lib/branding/palette';
import {
  removeBannerAction,
  removeLogoAction,
  uploadBannerAction,
  uploadLogoAction,
} from '@/app/dashboard/branding/actions';
import { inr } from '@/lib/demo-data';
import { OwnerPage, PageHead, Panel, Card, btn } from '@/components/owner/chrome';

/**
 * Menu branding.
 *
 * WHAT THIS SCREEN IS FOR
 *
 * A guest's first two seconds on the menu are spent deciding whether this is
 * the restaurant they sat down in. The name, a mark and a photograph are what
 * answer that. Nothing here changes the layout or the colours -- the menu is
 * shared and stays shared, and every restaurant's guests see the same design
 * (lib/branding/palette.ts, guestAccentStyle) -- so the whole task is three
 * decisions: mark, banner, and checking the result.
 *
 * THE ACCENT PICKER IS GONE, AND WHY
 *
 * It used to sit here, with six swatches and a Save button, and it repainted
 * the guest menu. When the guest flow became one design for every customer
 * that control stopped doing anything visible -- a colour an owner could
 * choose, save, and never see. A control that changes nothing is worse than no
 * control: it costs a decision and returns a lie. `restaurants.accent` still
 * holds the old value, untouched, in case per-restaurant theming ever becomes
 * a product decision rather than a side effect of plumbing.
 *
 * THE PREVIEW IS THE REAL HEADER
 *
 * The panel at the bottom renders `MenuIdentity`, the exact component the
 * guest menu renders, with this restaurant's data. It is not a mockup, so it
 * cannot drift from the product -- and it is the reason the screen can promise
 * "this is what they see" without a second implementation to maintain.
 *
 * WHY EVERY CONTROL IS A FORM
 *
 * These are server actions posting FormData with a File. They work with
 * JavaScript disabled, they cannot be replayed from a stale render, and the
 * restaurant id never travels in the payload -- it comes from the session on
 * the server (see lib/db/staff.ts).
 */
const pickerLabel =
  'relative inline-flex h-8 cursor-pointer items-center rounded-full border border-hair-strong px-3 text-[12.5px] font-medium text-gink transition-colors hover:border-gink-28 hover:bg-gink-07 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gink';

export function BrandingScreen({
  data,
  outlet,
  error,
  notice,
}: {
  data: BrandingScreenData | null;
  outlet?: OutletBar | null;
  error?: string;
  notice?: string;
}) {
  if (data?.blocked) {
    return (
      <OwnerPage active="branding" outlet={outlet}>
        <SignInPrompt reason={data.blocked} screen="branding screen" />
      </OwnerPage>
    );
  }

  const live = Boolean(data);
  const canEdit = Boolean(data?.canEdit);
  const disabled = !live || !canEdit;
  const name = data?.name || 'Your restaurant';

  return (
    <OwnerPage active="branding" outlet={outlet}>
      <PageHead
        kicker="Menu branding"
        title={name}
        meta="Your mark and a banner if you have one. The layout and the colours are shared, so every guest at every table reads the same menu."
      />

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-[12px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-4 py-3"
        >
          <strong className="text-[12.5px] text-[var(--alert)]">Nothing was saved.</strong>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-64">{error}</p>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mb-3 rounded-[12px] border border-[var(--p-accent)]/25 bg-accent-soft px-4 py-2.5"
        >
          <strong className="text-[12.5px] text-gink">Saved.</strong>{' '}
          <span className="text-[12.5px] text-gink-64">{notice}</span>
        </div>
      )}

      {!live && (
        <div className="mb-3 rounded-[12px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-4 py-3 text-[11.5px] leading-[1.55] text-gink-64">
          <strong className="font-semibold text-gink">The database is not connected.</strong> There is
          no restaurant to brand, so these controls cannot save. Nothing here is sample data.
        </div>
      )}

      {live && !canEdit && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[12px] border border-hair bg-paper-deep px-4 py-3 text-[11.5px] leading-[1.55] text-gink-64">
          <strong className="font-semibold text-gink">Read-only for your role.</strong> Branding is
          changed by the owner or a manager.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* --------------------------------------------------------------- logo */}
        <Panel title="Logo" meta="Shown beside your name" bodyClassName="px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <p className="m-0 max-w-[38ch] text-[12.5px] leading-[1.5] text-gink-46">
              Shown in a circle next to your name. A square image works best; we crop nothing.
            </p>

            {/* The mark at the size a guest sees it, not a thumbnail. */}
            <div className="shrink-0">
              {data?.logoUrl ? (
                <Image
                  src={data.logoUrl}
                  alt={`${name} logo`}
                  width={72}
                  height={72}
                  className="size-[72px] rounded-full object-cover ring-1 ring-hair"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-[72px] place-items-center rounded-full bg-paper-deep text-[20px] font-medium tracking-[-0.02em] text-gink-46"
                >
                  {initials(name)}
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <form action={uploadLogoAction} className="flex flex-wrap items-center gap-1.5">
              <label className={[pickerLabel, disabled ? 'pointer-events-none opacity-45' : ''].join(' ')}>
                <input
                  type="file"
                  name="logo"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={disabled}
                  required
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
                <span>{data?.logoUrl ? 'Replace logo' : 'Choose a logo'}</span>
              </label>
              <button type="submit" className={btn('solid', 'sm')} disabled={disabled}>
                Upload
              </button>
            </form>

            {data?.logoUrl && (
              <form action={removeLogoAction}>
                <button
                  type="submit"
                  className={`${btn('quiet', 'sm')} hover:text-[var(--alert)]`}
                  disabled={disabled}
                >
                  Remove logo
                </button>
              </form>
            )}
          </div>
          <p className="mt-2 text-[11.5px] leading-[1.45] text-gink-46">JPG, PNG or WebP · up to 2 MB</p>
        </Panel>

        {/* ------------------------------------------------------------- banner */}
        <Panel title="Banner" meta="Optional" bodyClassName="px-4 py-4 sm:px-5">
          <p className="m-0 max-w-[46ch] text-[12.5px] leading-[1.5] text-gink-46">
            A wide photo of the room or a signature dish. Skip it and the header uses your paper
            background instead — both are finished designs.
          </p>

          <div className="relative mt-3 aspect-[16/7] w-full overflow-hidden rounded-[10px] border border-hair bg-paper-deep">
            {data?.bannerUrl ? (
              <Image
                src={data.bannerUrl}
                alt="Current banner"
                fill
                sizes="(max-width: 900px) 100vw, 520px"
                className="object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="grid size-full place-items-center text-[11.5px] text-gink-46"
              >
                No banner — paper header
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <form action={uploadBannerAction} className="flex flex-wrap items-center gap-1.5">
              <label className={[pickerLabel, disabled ? 'pointer-events-none opacity-45' : ''].join(' ')}>
                <input
                  type="file"
                  name="banner"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={disabled}
                  required
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
                <span>{data?.bannerUrl ? 'Replace banner' : 'Choose a banner'}</span>
              </label>
              <button type="submit" className={btn('solid', 'sm')} disabled={disabled}>
                Upload
              </button>
            </form>

            {data?.bannerUrl && (
              <form action={removeBannerAction}>
                <button
                  type="submit"
                  className={`${btn('quiet', 'sm')} hover:text-[var(--alert)]`}
                  disabled={disabled}
                >
                  Remove banner
                </button>
              </form>
            )}
          </div>
          <p className="mt-2 text-[11.5px] leading-[1.45] text-gink-46">
            JPG, PNG or WebP · up to 4 MB · wide, at least 1200px across
          </p>
        </Panel>

        {/* ------------------------------------------------------------ preview */}
        <section aria-labelledby="branding-preview">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2.5">
              <h2 id="branding-preview" className="text-[13px] font-semibold text-gink">
                Preview
              </h2>
              <span className="text-[12.5px] text-gink-46">The real header, with your data.</span>
            </div>
            {live && (
              <Link href="/dashboard/branding/preview" className={btn('ghost', 'sm')}>
                Open full preview
              </Link>
            )}
          </div>

          <Card
            className="bg-paper-deep px-4 py-6"
            /* The flow's own colours, not this restaurant's row: the preview
               has to show what a guest will actually see, and that is the same
               for every restaurant. */
            style={guestAccentStyle() as React.CSSProperties}
          >
            {/* A phone, at phone width. Narrower and the header wraps differently
                from the real thing; wider and it stops being a preview. */}
            <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[18px] border border-hair-strong bg-card">
              <MenuIdentity
                name={name}
                tagline={data?.tagline}
                logoUrl={data?.logoUrl}
                bannerUrl={data?.bannerUrl}
                tableLabel="Table 7"
              />

              <div className="px-4 py-3">
                {(data?.sampleDishes ?? []).slice(0, 3).map((dish) => (
                  <div
                    key={dish.id}
                    className="flex items-center justify-between gap-3 border-b border-hair py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-medium text-gink">{dish.name}</div>
                      <div className="text-[11.5px] text-gink-46 tabular-nums">{inr(dish.price)}</div>
                    </div>
                    <span
                      aria-hidden="true"
                      className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--p-accent)] text-[15px] leading-none text-white"
                    >
                      +
                    </span>
                  </div>
                ))}

                {(data?.sampleDishes ?? []).length === 0 && (
                  <p className="m-0 py-2 text-center text-[11.5px] leading-[1.5] text-gink-46">
                    Add a dish and it appears here.
                  </p>
                )}
              </div>
            </div>
          </Card>

          {live && !data?.hasPublishedMenu && (
            <p className="mt-2 text-[11.5px] leading-[1.5] text-gink-46">
              Nothing is published yet, so guests still see a closed menu. Publish from{' '}
              <Link
                href="/dashboard/menus"
                className="font-medium text-gink underline decoration-hair-strong underline-offset-2"
              >
                Menus
              </Link>{' '}
              when you are ready.
            </p>
          )}
        </section>
      </div>
    </OwnerPage>
  );
}

/** Two letters, for the placeholder before a logo exists. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('') || 'A';
}
