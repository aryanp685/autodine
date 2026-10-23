import Link from 'next/link';
import type { ReactNode } from 'react';
import { DashboardBar } from '@/components/DashboardBar';
import type { DashboardSection } from '@/components/shell-links';
import type { OutletBar } from '@/lib/outlets';
import { RouteSkeleton } from '@/components/RouteSkeleton';

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
      <div className="lg:pl-[232px]">
        <main
          className={[
            'mx-auto w-full px-5 pt-6 pb-20 sm:px-7 lg:pt-9',
            wide ? 'max-w-[1320px]' : 'max-w-[1180px]',
          ].join(' ')}
        >
          {children}
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
    <header className="mb-7 flex flex-col gap-4 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {kicker ? (
          <p className="text-[10.5px] font-semibold tracking-[0.16em] text-gink-46 uppercase">{kicker}</p>
        ) : null}
        <h1 className="mt-2 text-[clamp(1.65rem,3vw,2.35rem)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-gink">
          {title}
        </h1>
        {meta ? <p className="mt-2 max-w-[62ch] text-[13.5px] leading-[1.55] text-gink-64">{meta}</p> : null}
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
        <h2 className="text-[13px] font-semibold tracking-[0.01em] text-gink">{title}</h2>
        {meta ? <span className="text-[12px] text-gink-46">{meta}</span> : null}
      </div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------- surfaces */

/** A hairline card. No shadow: on white, a shadow reads as a smudge. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={['rounded-[14px] border border-hair bg-card', className].join(' ')}>{children}</div>
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hair px-4 py-3 sm:px-5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[13px] font-semibold text-gink">{title}</h2>
          {meta ? <span className="text-[12px] text-gink-46">{meta}</span> : null}
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
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  /** `live` tints the card green: in use right now, not just a figure. */
  tone?: 'plain' | 'live';
}) {
  return (
    <div
      className={[
        'rounded-[14px] border p-4 sm:p-[18px]',
        tone === 'live' ? 'border-[var(--p-accent)]/25 bg-accent-soft' : 'border-hair bg-card',
      ].join(' ')}
    >
      <div className="text-[11px] font-medium tracking-[0.03em] text-gink-46">{label}</div>
      <div className="mt-2.5 text-[clamp(1.6rem,2.6vw,2.15rem)] leading-none font-medium tracking-[-0.045em] text-gink tabular-nums">
        {value}
      </div>
      {meta ? <div className="mt-2 text-[11.5px] leading-[1.4] text-gink-46">{meta}</div> : null}
    </div>
  );
}

export function Empty({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={[
        'rounded-[12px] border border-dashed border-hair-strong px-4 py-8 text-center text-[13px] leading-[1.55] text-gink-46',
        className,
      ].join(' ')}
    >
      {children}
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
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gink disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0';
  const box = size === 'sm' ? 'h-8 px-3 text-[12px]' : 'h-10 px-4 text-[13px]';
  const tones: Record<BtnTone, string> = {
    /* Black is the default action on white. It is the strongest thing on the
       screen without introducing a colour the product does not own. */
    solid: 'bg-gink text-onink hover:bg-gink/88',
    /* Green is for the one action a screen exists for -- the counter's
       "Record payment", the menu's "Publish". Used twice on a page it stops
       meaning anything. */
    primary: 'bg-[var(--p-accent)] text-white hover:opacity-92',
    ghost: 'border border-hair-strong text-gink hover:border-gink-28 hover:bg-gink-07',
    quiet: 'text-gink-64 hover:text-gink hover:bg-gink-07',
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
      <label htmlFor={htmlFor} className="mb-1.5 block text-[11.5px] font-medium text-gink-64">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[11.5px] leading-[1.45] text-[var(--alert)]">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[11.5px] leading-[1.45] text-gink-46">{hint}</p>
      ) : null}
    </div>
  );
}

const control =
  'w-full rounded-[9px] border border-hair-strong bg-card px-3 text-[13.5px] text-gink transition-colors placeholder:text-gink-28 focus:border-gink focus:ring-2 focus:ring-gink/10 focus:outline-none disabled:cursor-not-allowed disabled:bg-gink-07 disabled:text-gink-46';

export const inputClass = `${control} h-10`;
export const textareaClass = `${control} resize-y py-2.5 leading-[1.5]`;
export const selectClass = `${control} h-10 pr-8`;

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
        'border-b border-hair px-4 py-2.5 text-[10.5px] font-semibold tracking-[0.09em] whitespace-nowrap text-gink-46 uppercase',
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
        'border-b border-hair px-4 py-3 align-middle text-gink',
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
    <tr className={['transition-colors hover:bg-paper-deep', className].join(' ')} {...rest}>
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
  const tones: Record<PillTone, string> = {
    live: 'bg-accent-soft text-[var(--p-accent)] ring-[var(--p-accent)]/20',
    work: 'bg-[color-mix(in_srgb,var(--p-accent-soft)_55%,white)] text-[var(--p-accent)] ring-[var(--p-accent)]/15',
    due: 'bg-[var(--alert)]/8 text-[var(--alert)] ring-[var(--alert)]/20',
    failed: 'bg-[var(--alert)]/8 text-[var(--alert)] ring-[var(--alert)]/20',
    neutral: 'bg-paper-deep text-gink-64 ring-hair',
    ink: 'bg-gink text-onink ring-transparent',
  };
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.02em] whitespace-nowrap ring-1 ring-inset',
        tones[tone],
      ].join(' ')}
    >
      {children}
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
