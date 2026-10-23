import Link from 'next/link';
import Image from 'next/image';
import { DashboardBar } from '@/components/DashboardBar';
import { SignInPrompt } from '@/components/SignInPrompt';
import { MenuIdentity } from '@/components/MenuIdentity';
import type { OutletBar } from '@/lib/outlets';
import type { BrandingScreenData } from '@/lib/db/branding-screen';
import { ACCENTS, accentFrom } from '@/lib/branding/palette';
import {
  removeBannerAction,
  removeLogoAction,
  saveAccentAction,
  uploadBannerAction,
  uploadLogoAction,
} from '@/app/dashboard/branding/actions';
import { inr } from '@/lib/demo-data';

/**
 * Menu branding.
 *
 * WHAT THIS SCREEN IS FOR
 *
 * A guest's first two seconds on the menu are spent deciding whether this is
 * the restaurant they sat down in. The name, a mark, a photograph and one
 * accent colour are what answer that. Nothing here changes the layout -- the
 * menu is shared and stays shared -- so the whole task is four decisions, and
 * the screen is built to make them in that order: mark, banner, colour, look.
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
      <div className="pg pg--dash" data-surface="owner">
        <DashboardBar active="branding" outlet={outlet} />
        <div className="pg__body">
          <SignInPrompt reason={data.blocked} screen="branding screen" />
        </div>
      </div>
    );
  }

  const live = Boolean(data);
  const canEdit = Boolean(data?.canEdit);
  const disabled = !live || !canEdit;
  const accent = accentFrom(data?.accent);
  const name = data?.name || 'Your restaurant';

  return (
    <div className="pg pg--dash" data-surface="owner">
      <DashboardBar active="branding" outlet={outlet} />

      <div className="pg__body">
        <header className="pg__head">
          <div className="pg__kicker">Menu branding</div>
          <h1 className="pg__title">{name}</h1>
          <p className="pg__lede">
            Your mark, a banner if you have one, and one accent colour. The menu layout is shared; these
            are the four things that make it yours.
          </p>
        </header>

        {error && (
          <div className="pg__alert" role="alert">
            <strong>Nothing was saved.</strong>
            <p>{error}</p>
          </div>
        )}
        {notice && (
          <div className="pg__success" role="status">
            <strong>Saved.</strong>
            <p>{notice}</p>
          </div>
        )}

        {!live && (
          <div className="pg__note pg__note--warn">
            <strong>The database is not connected.</strong> There is no restaurant to brand, so these
            controls cannot save. Nothing here is sample data.
          </div>
        )}

        {live && !canEdit && (
          <div className="pg__note pg__note--info">
            <strong>Read-only for your role.</strong> Branding is changed by the owner or a manager.
          </div>
        )}

        <div className="brand__grid">
          {/* ------------------------------------------------------------ logo */}
          <section className="pg__formCard">
            <div className="brand__row">
              <div>
                <h2 className="pg__h2">Logo</h2>
                <p className="pg__p">
                  Shown in a circle next to your name. A square image works best; we crop nothing.
                </p>
              </div>

              <div className="brand__logoPreview">
                {data?.logoUrl ? (
                  <Image
                    src={data.logoUrl}
                    alt={`${name} logo`}
                    width={72}
                    height={72}
                    className="brand__logoImg"
                  />
                ) : (
                  <span className="brand__logoEmpty" aria-hidden="true">
                    {initials(name)}
                  </span>
                )}
              </div>
            </div>

            <form action={uploadLogoAction} className="brand__upload">
              <label className="brand__picker">
                <input
                  type="file"
                  name="logo"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={disabled}
                  required
                />
                <span>{data?.logoUrl ? 'Replace logo' : 'Choose a logo'}</span>
              </label>
              <button type="submit" className="pg__btn" disabled={disabled}>
                Upload
              </button>
            </form>
            <p className="brand__fine">JPG, PNG or WebP · up to 2 MB</p>

            {data?.logoUrl && (
              <form action={removeLogoAction}>
                <button type="submit" className="brand__remove" disabled={disabled}>
                  Remove logo
                </button>
              </form>
            )}
          </section>

          {/* ---------------------------------------------------------- banner */}
          <section className="pg__formCard">
            <div className="brand__row">
              <div>
                <h2 className="pg__h2">Banner</h2>
                <p className="pg__p">
                  Optional. A wide photo of the room or a signature dish. Skip it and the header uses
                  your paper background instead — both are finished designs.
                </p>
              </div>
            </div>

            {data?.bannerUrl ? (
              <div className="brand__bannerPreview">
                <Image
                  src={data.bannerUrl}
                  alt="Current banner"
                  fill
                  sizes="(max-width: 900px) 100vw, 520px"
                  className="brand__bannerImg"
                />
              </div>
            ) : (
              <div className="brand__bannerEmpty" aria-hidden="true">
                <span>No banner — paper header</span>
              </div>
            )}

            <form action={uploadBannerAction} className="brand__upload">
              <label className="brand__picker">
                <input
                  type="file"
                  name="banner"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={disabled}
                  required
                />
                <span>{data?.bannerUrl ? 'Replace banner' : 'Choose a banner'}</span>
              </label>
              <button type="submit" className="pg__btn" disabled={disabled}>
                Upload
              </button>
            </form>
            <p className="brand__fine">JPG, PNG or WebP · up to 4 MB · wide, at least 1200px across</p>

            {data?.bannerUrl && (
              <form action={removeBannerAction}>
                <button type="submit" className="brand__remove" disabled={disabled}>
                  Remove banner
                </button>
              </form>
            )}
          </section>

          {/* ---------------------------------------------------------- accent */}
          <section className="pg__formCard">
            <h2 className="pg__h2">Accent colour</h2>
            <p className="pg__p">
              Used for buttons, the add control and the table badge. These six are the only options:
              each one is checked to stay readable on paper and under white text.
            </p>

            <form action={saveAccentAction} className="brand__swatches">
              {ACCENTS.map((option) => {
                const checked = option.key === accent.key;
                return (
                  <label
                    key={option.key}
                    className={`brand__swatch ${checked ? 'is-on' : ''}`}
                    style={{ ['--swatch' as string]: option.accent }}
                  >
                    <input
                      type="radio"
                      name="accent"
                      value={option.key}
                      defaultChecked={checked}
                      disabled={disabled}
                    />
                    <span className="brand__swatchDot" aria-hidden="true" />
                    <span className="brand__sr">{option.label}</span>
                  </label>
                );
              })}
              <button type="submit" className="pg__btn" disabled={disabled}>
                Save colour
              </button>
            </form>
          </section>

          {/* --------------------------------------------------------- preview */}
          <section className="pg__formCard brand__previewCard">
            <div className="brand__row">
              <div>
                <h2 className="pg__h2">Preview</h2>
                <p className="pg__p">The real header, with your data.</p>
              </div>
              {live && (
                <Link href="/dashboard/branding/preview" className="pg__btn">
                  Open full preview
                </Link>
              )}
            </div>

            <div className="brand__phone" style={{ ['--p-accent' as string]: accent.accent, ['--p-accent-soft' as string]: accent.soft }}>
              <div className="brand__phoneInner">
                <MenuIdentity
                  name={name}
                  tagline={data?.tagline}
                  logoUrl={data?.logoUrl}
                  bannerUrl={data?.bannerUrl}
                  tableLabel="Table 7"
                />

                <div className="brand__previewList">
                  {(data?.sampleDishes ?? []).slice(0, 3).map((dish) => (
                    <div key={dish.id} className="brand__previewRow">
                      <div>
                        <div className="brand__previewName">{dish.name}</div>
                        <div className="brand__previewPrice tnum">{inr(dish.price)}</div>
                      </div>
                      <span className="brand__previewAdd" aria-hidden="true">
                        +
                      </span>
                    </div>
                  ))}

                  {(data?.sampleDishes ?? []).length === 0 && (
                    <p className="brand__previewEmpty">
                      Add a dish and it appears here, in your colours.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {live && !data?.hasPublishedMenu && (
              <p className="brand__fine">
                Nothing is published yet, so guests still see a closed menu. Publish from{' '}
                <Link href="/dashboard/menus">Menus</Link> when you are ready.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Two letters, for the placeholder before a logo exists. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('') || 'A';
}
