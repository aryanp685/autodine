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
import {
  BtnLink,
  Card,
  Notice,
  OwnerPage,
  PageHead,
  Panel,
  SectionHead,
  Tag,
  btn,
} from '@/components/owner/chrome';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { ImagePick } from '@/components/owner/ImagePick';

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
 * WHAT THE AUDIT FOUND (2026-10-24)
 *
 *   - Four hand-drawn callouts (failed save, saved, no database, read-only) in
 *     the same three reds the rest of the product had already replaced with the
 *     kit's Notice.
 *   - The screen's PRIMARY control was a `rounded-full h-8` pill: a status
 *     shape at a height nothing else on the surface uses, next to a rectangular
 *     Upload button on the same line. Fixed in owner/ImagePick.tsx.
 *   - Two buttons both called "Upload", on the same page, writing two different
 *     things.
 *   - `slug` was loaded by the data loader and never used, so the screen
 *     promised "this is what they see" with no way to reach what they see. It
 *     now offers the real guest menu, in a new tab.
 *   - The preview's dish rows ended in a copper circle with a "+" in it:
 *     pixel-for-pixel the guest menu's add button, and not a control. The row
 *     is now explicitly inert and says so once.
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

  // The real guest page for this restaurant. Built from the loaded slug, never
  // from a query string on this side -- and `data.slug` only exists when the
  // caller has a restaurant of their own.
  const guestMenuHref = live && data?.slug ? `/menu?s=${encodeURIComponent(data.slug)}` : null;

  return (
    <OwnerPage active="branding" outlet={outlet}>
      <PageHead
        kicker="Menu branding"
        title={name}
        meta="Your mark and a banner, on the guest menu. The layout and the colours are shared, so every guest at every table reads the same menu."
        actions={
          live ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {guestMenuHref ? (
                <a
                  href={guestMenuHref}
                  target="_blank"
                  rel="noreferrer"
                  className={btn('ghost', 'md')}
                >
                  Open guest menu
                </a>
              ) : null}
              <BtnLink href="/dashboard/branding/preview" tone="solid" size="md">
                Preview as a guest
              </BtnLink>
            </div>
          ) : null
        }
      />

      {error ? (
        <Notice tone="due" role="alert" label="Nothing was saved.">
          {error}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="accent" role="status" label="Saved.">
          {notice}
        </Notice>
      ) : null}

      {!live ? (
        <Notice tone="due" label="The database is not connected.">
          There is no restaurant to brand, so these controls cannot save. Nothing here is sample
          data.
        </Notice>
      ) : null}

      {live && !canEdit ? (
        <Notice tone="plain" label={<Tag tone="neutral">{data?.role || 'staff'}</Tag>}>
          <strong className="font-semibold text-gink">Read-only for your role.</strong> Branding is
          changed by the owner or a manager.
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        {/* --------------------------------------------------------------- logo
            Both asset panels have the same anatomy -- the artefact at the size a
            guest sees it, one line of copy, then the controls -- so the two sit
            side by side without one looking like an afterthought. */}
        <Panel
          title="Logo"
          meta={data?.logoUrl ? 'Set' : 'Not set'}
          bodyClassName="flex flex-1 flex-col px-4 py-4 sm:px-5"
        >
          <div className="flex items-start gap-4">
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
            <p className="m-0 max-w-[34ch] text-[12.5px] leading-[1.55] text-gink-46">
              Shown in a circle next to your name at the top of the guest menu. A square image works
              best; nothing is cropped away.
              {!data?.logoUrl ? ' Until one is uploaded, the circle carries your initials.' : ''}
            </p>
          </div>

          <div className="mt-auto flex flex-wrap items-start gap-2 pt-4">
            <ImagePick
              kind="logo"
              name="logo"
              action={uploadLogoAction}
              label="Choose a logo"
              replaceLabel="Replace logo"
              uploadLabel="Upload logo"
              hint="JPG, PNG or WebP · up to 2 MB"
              disabled={disabled}
              current={Boolean(data?.logoUrl)}
            />

            {data?.logoUrl ? (
              <form action={removeLogoAction}>
                <SubmitButton
                  tone="quiet"
                  pendingLabel="Removing…"
                  className="hover:text-[var(--alert)]"
                  disabled={disabled}
                >
                  Remove logo
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </Panel>

        {/* ------------------------------------------------------------- banner */}
        <Panel
          title="Banner"
          meta={data?.bannerUrl ? 'Set' : 'Optional'}
          bodyClassName="flex flex-1 flex-col px-4 py-4 sm:px-5"
        >
          <div className="relative aspect-[16/7] w-full overflow-hidden rounded-[var(--p-r-control)] border border-hair bg-paper-deep">
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
                className="grid size-full place-items-center px-4 text-center text-[11.5px] leading-[1.4] text-gink-46"
              >
                No banner — the header uses your paper background instead
              </span>
            )}
          </div>

          <p className="mt-2.5 max-w-[46ch] text-[12.5px] leading-[1.55] text-gink-46">
            A wide photo of the room or a signature dish. Skip it and the header uses paper instead —
            both are finished designs, and neither leaves a hole.
          </p>

          <div className="mt-auto flex flex-wrap items-start gap-2 pt-4">
            <ImagePick
              kind="banner"
              name="banner"
              action={uploadBannerAction}
              label="Choose a banner"
              replaceLabel="Replace banner"
              uploadLabel="Upload banner"
              hint="JPG, PNG or WebP · up to 4 MB · wide, at least 1200px across"
              disabled={disabled}
              current={Boolean(data?.bannerUrl)}
            />

            {data?.bannerUrl ? (
              <form action={removeBannerAction}>
                <SubmitButton
                  tone="quiet"
                  pendingLabel="Removing…"
                  className="hover:text-[var(--alert)]"
                  disabled={disabled}
                >
                  Remove banner
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </Panel>
      </div>

      {/* -------------------------------------------------------------- preview */}
      <section aria-labelledby="branding-preview" className="mt-6">
        <SectionHead
          title={<span id="branding-preview">Preview</span>}
          meta="The real header, with your data — not a mock-up"
          action={
            live ? (
              <BtnLink href="/dashboard/branding/preview" tone="ghost" size="sm">
                Open full preview
              </BtnLink>
            ) : null
          }
        />

        <Card
          className="bg-paper-deep px-4 py-6"
          /* The flow's own colours, not this restaurant's row: the preview has
             to show what a guest will actually see, and that is the same for
             every restaurant. */
          style={guestAccentStyle() as React.CSSProperties}
        >
          {/* A phone, at phone width. Narrower and the header wraps differently
              from the real thing; wider and it stops being a preview. */}
          <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[var(--p-r-card)] border border-hair-strong bg-card">
            <MenuIdentity
              name={name}
              tagline={data?.tagline}
              logoUrl={data?.logoUrl}
              bannerUrl={data?.bannerUrl}
              tableLabel="Table 7"
            />

            {/*
             * Inert on purpose, and marked as such.
             *
             * This block wears the guest menu's dish rows -- including the
             * copper "+" -- and none of it is a control. Without
             * `pointer-events-none` and `aria-hidden` the row is
             * pixel-for-pixel the real add button, which is the exact class of
             * fake control this product has had to remove before.
             */}
            <div aria-hidden="true" className="pointer-events-none select-none px-4 py-3">
              {(data?.sampleDishes ?? []).slice(0, 3).map((dish) => (
                <div
                  key={dish.id}
                  className="flex items-center justify-between gap-3 border-b border-hair py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium text-gink">{dish.name}</div>
                    <div className="text-[11.5px] text-gink-46 tabular-nums">{inr(dish.price)}</div>
                  </div>
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--p-accent)] text-[15px] leading-none text-white">
                    +
                  </span>
                </div>
              ))}

              {(data?.sampleDishes ?? []).length === 0 ? (
                <p className="m-0 py-2 text-center text-[11.5px] leading-[1.5] text-gink-46">
                  Add a dish and it appears here.
                </p>
              ) : null}
            </div>
          </div>
        </Card>

        <p className="mt-2 text-[11.5px] leading-[1.55] text-gink-46">
          The header above is the real component, so it cannot drift from the menu. The dishes under
          it are a sample and are not tappable here — open the guest menu to try a real row.
        </p>

        {live && !data?.hasPublishedMenu ? (
          <Notice
            tone="due"
            label="Nothing is published yet."
            className="mt-3 mb-0"
            action={
              <Link href="/dashboard/menus" className={btn('ghost', 'sm')}>
                Go to Menus
              </Link>
            }
          >
            Guests still see a closed menu, so none of this is visible to them yet. Publish a menu
            when you are ready.
          </Notice>
        ) : null}
      </section>

      {/* ------------------------------------------------------------- the notes
          One short list, because the questions this screen raises are always the
          same three: what changes, and does the name live here? */}
      <div className="mt-4 grid gap-2.5 lg:grid-cols-2">
        <Notice tone="plain" label="Where these appear">
          The logo and the banner are the top of the guest menu, and nothing else — not the bill, not
          the kitchen board. Name and tagline live in{' '}
          <Link
            href="/dashboard/settings"
            className="font-medium text-gink underline decoration-hair-strong underline-offset-2"
          >
            Settings
          </Link>
          .
        </Notice>
        <Notice tone="plain" label="Shared on purpose">
          Every restaurant&apos;s menu looks the same: same layout, same colours, same type. That is
          what lets a guest order at any table in any restaurant without learning a new screen.
        </Notice>
      </div>
    </OwnerPage>
  );
}

/** Two letters, for the placeholder before a logo exists. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('') || 'A';
}
