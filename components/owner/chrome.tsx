import Link from 'next/link';
import type { ReactNode } from 'react';
import { DashboardBar } from '@/components/DashboardBar';
import type { DashboardSection } from '@/components/shell-links';
import type { OutletBar } from '@/lib/outlets';
import { RouteSkeleton } from '@/components/RouteSkeleton';
import { PageMotion } from '@/components/owner/PageMotion';

/**
 * The staff-side kit.
 *
 * WHY A KIT AND NOT CLASS NAMES IN EVERY SCREEN
 *
 * Fifteen screens share one visual contract: a page frame, a hairline card, a
 * table that holds numbers in columns, a button that is black when it is the
 * action and a hairline when it is not. Written screen by screen, that contract
 * drifts by the third screen -- a 13px button here, a 12px one there, one card
 * with a shadow and nine without. Every screen before this one had its own
 * slightly different copy of the same four things.
 *
 * So the shapes live here once, in Tailwind, and the screens compose them.
 *
 * THE SURFACE
 *
 * White paper, black ink, one green for "this is live" and "this is where you
 * are". Nothing warm: an owner sits in front of this for six hours under tube
 * lights, and warm cream at that size reads as beige. The tokens come from
 * `[data-surface='owner']` in styles/owner.css, so `bg-paper` is white here and
 * the guest's warm paper on the guest flow -- same utility, different surface.
 *
 * WIDTH
 *
 * 1180px. Wide enough for six table columns without horizontal scroll on a
 * 1280 laptop, narrow enough that a line of text does not run 140 characters.
 */

/* --------------------------------------------------------------- the frame */

export function OwnerPage({
  active,
  outlet,
  signOut,
  children,
  wide = false,
}: {
  active?: DashboardSection;
  outlet?: OutletBar | null;
  signOut?: boolean;
  children: ReactNode;
  /** Report tables need the full width; a settings form does not. */
  wide?: boolean;
}) {
  return (
    <div data-surface="owner" className="min-h-dvh bg-paper text-gink antialiased">
      <DashboardBar active={active} outlet={outlet} signOut={signOut} />
      <div className="lg:pl-[244px]">
        <main
          className={[
            'mx-auto w-full px-5 pt-6 pb-20 sm:px-7 lg:pt-9',
            wide ? 'max-w-[1320px]' : 'max-w-[1180px]',
          ].join(' ')}
        >
          {/*
           * The arrival, not the layout. PageMotion sends its final state from
           * the server and animates from keyframes only once the client is
           * alive, so a blocked bundle leaves a visible page rather than an
           * invisible one -- see the file for why that distinction is the
           * whole point of using it instead of `initial={{ opacity: 0 }}`.
           */}
          <PageMotion>{children}</PageMotion>
        </main>
      </div>
    </div>
  );
}

/**
 * Kicker, title, one line of context, and the actions for this page.
 *
 * The actions sit on the same baseline as the title on a wide screen and wrap
 * under it on a phone. They are never in both places: a screen with its
 * primary action at the top and again at the bottom is a screen that has not
 * decided where the action is.
 */
export function PageHead({
  kicker,
  title,
  meta,
  actions,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {kicker ? (
          <p className="text-[10.5px] font-semibold tracking-[0.18em] text-[var(--p-accent)] uppercase">
            {kicker}
          </p>
        ) : null}
        {/* The one display size on a staff screen. Tight tracking and a short
            leading are what separate a masthead from a heading in a form. */}
        <h1 className="mt-2.5 text-[clamp(1.75rem,2.6vw,2.5rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-gink">
          {title}
        </h1>
        {meta ? <p className="mt-2.5 max-w-[62ch] text-[13.5px] leading-[1.6] text-gink-64">{meta}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div> : null}
    </header>
  );
}

/** A section heading inside a page, above a card or a row of cards. */
export function SectionHead({
  title,
  meta,
  action,
  className = '',
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={['mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1', className].join(' ')}>
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-gink">{title}</h2>
        {meta ? <span className="text-[12.5px] text-gink-46">{meta}</span> : null}
      </div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------- surfaces */

/**
 * The panel every staff screen is built from.
 *
 * A translucent surface with an inset highlight and one contact shadow -- see
 * the owner section of app/globals.css for the tokens. It used to be a flat
 * white card with no shadow, on the argument that a shadow on white is a
 * smudge; on a wash, the absence of an edge is what makes a page of cards look
 * like a page of rectangles.
 *
 * `lift` is for a card that opens something. A card that only changes its
 * border on hover says nothing about being clickable.
 */
export function Card({
  children,
  className = '',
  style,
  lift = false,
}: {
  children: ReactNode;
  className?: string;
  /** For the one card that carries a preview's accent variables. */
  style?: React.CSSProperties;
  /** Set on a card that is itself a link target. */
  lift?: boolean;
}) {
  return (
    <div
      className={['rounded-[18px] border border-hair bg-card', lift ? 'o-lift' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {children}
    </div>
  );
}

/** A card with a heading row, for anything that is a titled block. */
export function Panel({
  title,
  meta,
  action,
  children,
  className = '',
  bodyClassName = 'px-4 py-4 sm:px-5',
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-t-[17px] border-b border-hair bg-[rgba(25,20,17,0.022)] px-4 py-3.5 sm:px-5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-gink">{title}</h2>
          {meta ? <span className="text-[12.5px] text-gink-46">{meta}</span> : null}
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}

/**
 * A number and what it means.
 *
 * The figure is the one large thing on the row, set in tabular figures so a
 * column of them does not shiver as the numbers change. The label above it is
 * small and wide-tracked; the note below says what the number counts, because
 * "Revenue today" over a total that excludes pending payments is a question
 * the owner should not have to ask.
 */
export function Stat({
  label,
  value,
  meta,
  tone = 'plain',
  lead = false,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  /**
   * `live` tints the card green: in use right now, not just a figure.
   * `due` tints it with the alert colour: a number somebody has to act on,
   * such as money still outstanding. Green on an unpaid total told the owner
   * the opposite of what the figure meant.
   */
  tone?: 'plain' | 'live' | 'due';
  /**
   * The one figure the screen is about, drawn larger than its neighbours.
   *
   * Four equal cards is not a hierarchy; it is a grid. On the overview the
   * day's takings are the number an owner opens the screen for, so it gets the
   * width, the size and the only warm wash on the row. Everything else stays
   * the same object at the same weight as its siblings.
   */
  lead?: boolean;
}) {
  return (
    <div
      className={[
        'relative overflow-hidden rounded-[18px] border transition-shadow duration-200',
        lead ? 'p-4 sm:p-5' : 'p-4 sm:p-[18px]',
        'sm:hover:shadow-[var(--p-shadow-2)]',
        tone === 'live'
          ? 'border-[color-mix(in_oklab,var(--p-accent)_26%,transparent)] bg-[color-mix(in_oklab,var(--p-accent-soft)_62%,white)]'
          : tone === 'due'
            ? 'border-[color-mix(in_oklab,var(--alert)_22%,transparent)] bg-[color-mix(in_oklab,var(--alert)_5%,white)]'
            : lead
              ? 'border-[color-mix(in_oklab,var(--p-accent)_18%,transparent)] bg-card'
              : 'border-hair bg-card',
      ].join(' ')}
    >
      {/* A wash, not a gradient: one low-opacity copper shadow in the corner of
          the lead card, so it reads as the important one before a word is
          read. */}
      {lead ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--p-accent)_13%,transparent),transparent_68%)]"
        />
      ) : null}
      <div
        className={[
          'relative',
          lead
            ? 'text-[11.5px] font-semibold tracking-[0.1em] text-gink-46 uppercase'
            : 'text-[12.5px] font-medium tracking-[0.005em] text-gink-64',
        ].join(' ')}
      >
        {label}
      </div>
      <div
        className={[
          'relative leading-[0.95] font-semibold tracking-[-0.05em] tabular-nums',
          lead
            ? 'mt-3 text-[clamp(1.75rem,4.4vw,3.1rem)]'
            : 'mt-2.5 text-[clamp(1.75rem,2.8vw,2.35rem)]',
          tone === 'due' ? 'text-[var(--alert)]' : 'text-gink',
        ].join(' ')}
      >
        {value}
      </div>
      {meta ? (
        <div className="relative mt-2 text-[11.5px] leading-[1.45] text-gink-46">{meta}</div>
      ) : null}
    </div>
  );
}

/**
 * A strip that states a fact about the workspace.
 *
 * The overview grew three of these, each drawn by hand: the plan line, the
 * preview notice and the "no orders yet" nudge. They had three different
 * radii, three paddings and three ways of ending in a link, which made a screen
 * that says at most one important thing look like an error log. This is that
 * shape, once: a hairline card, a small marker in the tone's colour, a short
 * bold lead, the sentence, and at most one quiet action pinned right.
 */
export function Notice({
  tone = 'plain',
  label,
  children,
  action,
  className = '',
  ...rest
}: {
  tone?: 'plain' | 'live' | 'due' | 'accent';
  /** A short lead, bold: two or three words, or a status tag. Named `label`
      rather than `title` so it does not shadow the div's own title attribute. */
  label?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
} & Omit<React.ComponentProps<'div'>, 'children' | 'className' | 'title'>) {
  const marks = {
    plain: 'bg-gink-28',
    live: 'bg-[var(--p-live)]',
    due: 'bg-[var(--p-due)]',
    accent: 'bg-[var(--p-accent)]',
  } as const;
  const rules = {
    plain: 'border-hair',
    live: 'border-[color-mix(in_oklab,var(--p-live)_22%,transparent)]',
    due: 'border-[color-mix(in_oklab,var(--p-due)_24%,transparent)]',
    accent: 'border-[color-mix(in_oklab,var(--p-accent)_24%,transparent)]',
  } as const;
  return (
    <div
      {...rest}
      className={[
        'mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border bg-card px-4 py-3',
        rules[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span aria-hidden="true" className={['size-1.5 shrink-0 rounded-full', marks[tone]].join(' ')} />
      {label ? <span className="text-[12.5px] font-medium text-gink">{label}</span> : null}
      <span className="min-w-0 text-[12.5px] leading-[1.5] text-gink-64">{children}</span>
      {action ? <span className="ml-auto shrink-0">{action}</span> : null}
    </div>
  );
}

/**
 * Nothing to show, said plainly.
 *
 * The dashed border is gone. A dashed rectangle is the visual grammar of a
 * placeholder -- a box waiting for content that has not arrived yet -- and this
 * product put one under every empty chart, every empty list and every empty
 * report. On a screen with four of them, the page read as unfinished rather
 * than as quiet, which is the opposite of what an empty day at a restaurant
 * means.
 *
 * What replaces it: a solid hairline on the same surface as the card it sits
 * in, a minimum height so a row of them lines up, and the message set at the
 * same size as the body text around it instead of a shade smaller.
 */
export function Empty({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={[
        'grid min-h-[104px] place-items-center rounded-[12px] border border-hair bg-[rgba(25,20,17,0.018)] px-5 py-7 text-center text-[12.5px] leading-[1.6] text-gink-46',
        className,
      ].join(' ')}
    >
      <span className="max-w-[46ch]">{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ buttons */

export type BtnTone = 'solid' | 'primary' | 'ghost' | 'quiet' | 'danger';
export type BtnSize = 'sm' | 'md';

/**
 * The class string for a button or a link that looks like one.
 *
 * A string rather than a component because these appear as `<button>`,
 * `<a>`, next/link and `<input type=submit>` across fifteen screens, and a
 * wrapper that renders one of those four would need a prop for each. What
 * matters is that they are identical, which the string guarantees.
 */
export function btn(tone: BtnTone = 'solid', size: BtnSize = 'md'): string {
  /*
   * ONE GEOMETRY.
   *
   * These were pills (rounded-full) at four different heights across the
   * product, and a pill is a status shape: it is what a tag uses. A row of a
   * pill button, a pill chip, a pill switch and a pill tag is a row of four
   * things that all look like the same kind of object.
   *
   * So actions are rectangles with a 10px radius, 36px tall (sm) or 44px (md),
   * and they are the only element on the surface with that radius. Pills come
   * back only for status, where the shape means "a state, not a control".
   */
  const base =
    'inline-flex items-center justify-center gap-2 rounded-[10px] font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0';
  const box = size === 'sm' ? 'h-9 px-3 text-[12.5px]' : 'h-11 px-4 text-[13px]';
  const tones: Record<BtnTone, string> = {
    /* Ink is the default action. It is the strongest thing on paper without
       introducing a colour the product does not own. */
    solid:
      'bg-gink text-onink shadow-[var(--p-shadow-1)] hover:bg-gink/92 hover:shadow-[var(--p-shadow-2)]',
    /* Copper is for the one action a screen exists for -- the counter's
       "Record payment", the menu's "Publish". Used twice on a page it stops
       meaning anything. */
    primary:
      'bg-[var(--p-accent)] text-onink shadow-[var(--p-shadow-1)] hover:brightness-110 hover:shadow-[var(--p-shadow-2)]',
    ghost:
      'border border-hair-strong bg-card text-gink shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] hover:border-gink-28 hover:bg-white',
    quiet: 'text-gink-64 hover:bg-gink-07 hover:text-gink',
    danger: 'border border-[var(--alert)]/30 text-[var(--alert)] hover:bg-[var(--alert)]/8',
  };
  return `${base} ${box} ${tones[tone]}`;
}

/** A button that is a link. */
export function BtnLink({
  href,
  tone = 'solid',
  size = 'md',
  children,
  className = '',
  ...rest
}: {
  href: string;
  tone?: BtnTone;
  size?: BtnSize;
  children: ReactNode;
  className?: string;
} & Omit<React.ComponentProps<typeof Link>, 'href' | 'className' | 'children'>) {
  return (
    <Link href={href} className={`${btn(tone, size)} ${className}`} {...rest}>
      {children}
    </Link>
  );
}

/**
 * A single-select row of pills: the payment method, the voice speed, how to
 * import a menu.
 *
 * WHY THIS IS ONE COMPONENT NOW
 *
 * Three screens had written this by hand -- one with `bg-paper-deep` and 12px
 * labels, one with a bare border and 11.5px labels, one announcing itself as a
 * tablist with no tabpanels to point at. All three meant the same thing: pick
 * exactly one of these. Written three times, they also had three different
 * heights, three focus rings, and one of them told a screen reader it was a tab
 * strip.
 *
 * `aria-pressed` on a group of toggle buttons is the honest description of
 * "one of these is the current choice". A tablist claim requires tabpanels,
 * arrow-key roving and `aria-controls`; a control that switches a panel it
 * cannot name is not a tab strip.
 *
 * The buttons are real buttons, so keyboard order is left to right, Enter and
 * Space both work, and the height matches `btn('sm')` so a segmented control
 * can sit beside a button without a step.
 */
export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  title?: string;
  /** Extra data attributes, for a test that needs to name one item. */
  data?: Record<string, string>;
};

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  size = 'md',
  fill = false,
  className = '',
}: {
  /** Names the group. A group of three buttons with no name is three buttons. */
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  size?: 'sm' | 'md';
  /**
   * Stretch to the container with equal-width items. For a control that is
   * the screen's only navigation on a phone, where three pills huddled at the
   * left edge are three small targets instead of one row.
   */
  fill?: boolean;
  className?: string;
}) {
  const box = size === 'sm' ? 'h-9' : 'h-11';
  const item = size === 'sm' ? 'h-7 px-2.5 text-[11.5px]' : 'h-9 px-3.5 text-[12.5px]';
  return (
    <div
      role="group"
      aria-label={label}
      className={[
        'items-center rounded-[10px] border border-hair-strong bg-paper-deep p-1',
        fill ? 'flex w-full' : 'inline-flex',
        box,
        className,
      ].join(' ')}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            title={option.title}
            onClick={() => onChange(option.value)}
            {...option.data}
            className={[
              'rounded-[7px] font-medium whitespace-nowrap transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]',
              fill ? 'flex flex-1 items-center justify-center gap-1.5' : '',
              item,
              on ? 'bg-card text-gink shadow-[var(--p-shadow-1)]' : 'text-gink-46 hover:text-gink',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The chip look, as a class, for a control that must be a link.
 *
 * Segmenteds are buttons because they change what is on the page. A time range
 * and an order filter are not: they are places, with a URL somebody can send to
 * a colleague, so they have to stay <Link> and cannot use the component. They
 * should still look and behave identically -- same height, same radius, same
 * pressed state -- and the keyboard must be able to see where it is, which the
 * hand-written copy on the orders screen did not do.
 */
export function chipClass(active: boolean): string {
  /*
   * A selected chip is copper, not a black block.
   *
   * The chip is an on-state -- "this window", "these rows" -- and copper is
   * what this product uses for position: the active rail row, the focus ring,
   * the page kicker. A black filled chip was the loudest thing on the orders
   * screen, louder than the row it was filtering, and it was the only control
   * on the surface that was a solid block of ink.
   *
   * Both states keep a border, so a chip does not change size when it is
   * picked and the row does not shiver.
   */
  return [
    'inline-flex h-9 items-center rounded-[10px] border px-3.5 text-[12.5px] font-medium whitespace-nowrap transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]',
    active
      ? 'border-[color-mix(in_oklab,var(--p-accent)_45%,transparent)] bg-accent-soft text-gink'
      : 'border-hair-strong bg-card text-gink-64 hover:border-gink-28 hover:text-gink',
  ].join(' ');
}

/* -------------------------------------------------------------------- forms */

/** A labelled field. The label is always visible -- a placeholder is not one. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-gink-64">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[11.5px] leading-[1.45] text-[var(--alert)]">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[11.5px] leading-[1.5] text-gink-46">{hint}</p>
      ) : null}
    </div>
  );
}

/*
 * A field is a white sheet on paper, with a warm hairline and a copper focus
 * ring. It was a 60%-white box that turned greyer as the page behind it got
 * lighter -- on paper, translucent inputs look like holes.
 */
const control =
  'w-full rounded-[10px] border border-hair-strong bg-card px-3.5 text-[13.5px] text-gink shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-[border-color,box-shadow] duration-150 placeholder:text-gink-28 hover:border-gink-28 focus:border-[var(--p-accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--p-accent)_16%,transparent)] focus:outline-none disabled:cursor-not-allowed disabled:bg-gink-07 disabled:text-gink-46';

export const inputClass = `${control} h-11`;
export const textareaClass = `${control} resize-y py-3 leading-[1.55]`;
export const selectClass = `${control} h-11 pr-8`;

/* ------------------------------------------------------------------- tables */

/** The scroll container. A table that overflows its card scrolls inside it. */
export function TableWrap({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={['-mx-4 overflow-x-auto sm:mx-0', className].join(' ')}>{children}</div>;
}

export const tableClass = 'w-full border-collapse text-[13px]';

/**
 * A header cell. Numbers are right-aligned from the header down, so a column
 * of figures has one edge instead of ten.
 */
export function Th({
  children,
  align = 'left',
  className = '',
  ...rest
}: { children?: ReactNode; align?: 'left' | 'right' } & React.ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={[
        'border-b border-hair px-4 py-2.5 text-[10.5px] font-semibold tracking-[0.1em] whitespace-nowrap text-gink-46 uppercase',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className = '',
  ...rest
}: { children?: ReactNode; align?: 'left' | 'right' } & React.ComponentProps<'td'>) {
  return (
    <td
      className={[
        'border-b border-hair px-4 py-3.5 align-middle text-gink',
        align === 'right' ? 'text-right tabular-nums' : 'text-left',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </td>
  );
}

/** A table row. The tint on hover is the whole interaction budget for a row. */
export function Tr({ children, className = '', ...rest }: React.ComponentProps<'tr'>) {
  return (
    <tr className={['transition-colors hover:bg-[rgba(25,20,17,0.025)]', className].join(' ')} {...rest}>
      {children}
    </tr>
  );
}

/* -------------------------------------------------------------------- pills */

export type PillTone = 'live' | 'due' | 'failed' | 'neutral' | 'ink' | 'work';

/**
 * A status pill.
 *
 * Colour is never the only signal: each tone carries its word. A green dot
 * that means "ready" and a red one that means "ready but late" would be
 * indistinguishable to a colour-blind cook, and this product is read standing
 * up.
 */
export function Tag({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  /*
   * Status, not button. A tag keeps the pill shape -- that is the one place a
   * pill still means something -- but loses the ring it used to carry, which
   * on a warm card read as a second border around a word.
   *
   * `live` is bottle green because it means "settled / ready"; copper is the
   * accent and is reserved for position and on-states.
   */
  const tones: Record<PillTone, string> = {
    live: 'bg-[color-mix(in_oklab,var(--p-live)_12%,white)] text-[var(--p-live)]',
    work: 'bg-[color-mix(in_oklab,var(--p-accent)_12%,white)] text-[var(--p-accent)]',
    due: 'bg-[color-mix(in_oklab,var(--p-due)_10%,white)] text-[var(--p-due)]',
    failed: 'bg-[color-mix(in_oklab,var(--p-due)_10%,white)] text-[var(--p-due)]',
    neutral: 'bg-paper-deep text-gink-64',
    ink: 'bg-gink text-onink',
  };
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold tracking-[0.01em] whitespace-nowrap',
        tones[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}

/**
 * The track and knob of a switch, without owning the control.
 *
 * Two screens draw a switch and they cannot share the control: the menu editor
 * submits a form (so it works with JavaScript off) and the kitchen toggles a
 * client-side preference. What they must share is the drawing -- 38x22 track,
 * 16px knob, no border -- or the product ends up with two switches that differ
 * by two pixels and look like two different ideas.
 *
 * `aria-hidden`: the state is announced by the control around it.
 */
export function SwitchTrack({ on, className = '' }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200',
        on ? 'bg-[var(--p-accent)]' : 'bg-[rgba(25,20,17,0.16)]',
        className,
      ].join(' ')}
    >
      <span
        className={[
          'absolute size-[16px] rounded-full bg-white shadow-[0_1px_2px_rgba(60,40,24,0.28)] transition-[left] duration-200 ease-out',
          on ? 'left-[19px]' : 'left-[3px]',
        ].join(' ')}
      />
    </span>
  );
}

/** A dot, for a status that is stated in words next to it. */
export function Dot({ tone = 'live' }: { tone?: 'live' | 'idle' | 'alert' }) {
  const tones = {
    live: 'bg-[var(--p-accent)]',
    idle: 'bg-gink-28',
    alert: 'bg-[var(--alert)]',
  } as const;
  return <span aria-hidden="true" className={['size-1.5 shrink-0 rounded-full', tones[tone]].join(' ')} />;
}

/**
 * What a staff screen shows while it is being fetched.
 *
 * The bar is part of the skeleton on purpose: the navigation is the one thing
 * that must never blink out between two staff screens, and without it the whole
 * top of the page disappears for the length of the round trip. `active` is
 * omitted by callers that do not know which screen is arriving -- claiming
 * "Overview" during a fetch to Reports is a lie told while somebody is waiting
 * to find out where they are.
 */
export function OwnerLoading({
  active,
  variant = 'dashboard',
}: {
  active?: DashboardSection;
  variant?: 'page' | 'rows' | 'board' | 'dashboard';
}) {
  return (
    <OwnerPage active={active}>
      <RouteSkeleton variant={variant} />
    </OwnerPage>
  );
}
