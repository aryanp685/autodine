import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';

/** Deterministic pseudo-QR so the layouts can be judged with realistic shapes.
 *  This is a decorative pattern, NOT a working QR code. */
export function QrChip({ value, size = 96 }: { value: string; size?: number }) {
  const n = 21;
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = (i: number) => {
    h ^= i * 2654435761;
    h = Math.imul(h, 40503);
    return ((h >>> 8) & 255) / 255;
  };
  const isFinder = (r: number, c: number) => {
    const inBox = (r0: number, c0: number) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7;
    const ring = (r0: number, c0: number) => {
      if (!inBox(r0, c0)) return null;
      const dr = r - r0;
      const dc = c - c0;
      const edge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      return edge || core;
    };
    return ring(0, 0) ?? ring(0, n - 7) ?? ring(n - 7, 0);
  };

  // One <path>, not one <rect> per dark cell.
  //
  // The obvious version pushes a <rect> for each of the ~210 dark cells in the
  // grid. That is 210 React elements per chip, and the RSC payload serialises
  // every one of them. /dashboard/tables renders 18 chips, so a single page
  // carried ~3,800 elements and 586 KB of HTML -- 23x the next heaviest page.
  //
  // Horizontal runs are merged, so a row of adjacent dark cells is one
  // subpath. The rendered result is identical: same cells, same fill.
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    let runStart = -1;
    for (let c = 0; c <= n; c++) {
      const f = c < n ? isFinder(r, c) : null;
      const on = c < n && (f === null ? rand(r * n + c) > 0.52 : f);
      if (on && runStart < 0) runStart = c;
      else if (!on && runStart >= 0) {
        const w = c - runStart;
        parts.push(`M${runStart} ${r}h${w}v1h-${w}z`);
        runStart = -1;
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      role="img"
      aria-label={`QR placeholder for ${value}`}
      style={{ background: '#fff', padding: 4, borderRadius: 6, display: 'block' }}
    >
      <path d={parts.join('')} fill="currentColor" />
    </svg>
  );
}

export function VegMark({ veg, size = 14 }: { veg: boolean; size?: number }) {
  /* The square-and-dot mark, drawn rather than typed. It is a legal marker in
     India, not a decoration, so the colours are the two conventional ones and
     they are hard-coded on purpose: a restaurant's accent must never repaint a
     dietary mark. */
  return (
    <span
      data-veg={veg ? 'veg' : 'non'}
      className={[
        'inline-grid shrink-0 place-items-center rounded-[3px] border-[1.5px] bg-transparent',
        veg ? 'border-[#1a7f37]' : 'border-[#9b2c2c]',
      ].join(' ')}
      style={{ width: size, height: size }}
      title={veg ? 'Vegetarian' : 'Non-vegetarian'}
      aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'}
    >
      <span
        aria-hidden="true"
        className="block rounded-full"
        style={{
          width: Math.max(4, Math.round(size * 0.42)),
          height: Math.max(4, Math.round(size * 0.42)),
          background: veg ? '#1a7f37' : '#9b2c2c',
        }}
      />
    </span>
  );
}

/**
 * An amount of money.
 *
 * `value` is PAISE, always -- the same unit as every *_paise column and every
 * money helper in lib/money.ts. It used to be formatted straight through
 * `inr()` without dividing by 100, which meant every live figure on the
 * dashboard read one hundred times too large: a day that took Rs 1,557.60 was
 * displayed as Rs 1,55,760. The demo rows passed whole rupees, so the bug was
 * invisible in preview mode and only ever appeared against real data.
 *
 * Callers holding rupees must convert at the boundary with rupeesToPaise().
 */
export function Money({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <span className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{inr(paiseToRupees(value))}</span>
  );
}

/**
 * A trend line.
 *
 * `className` exists so a chart can be fluid instead of pinned to a pixel
 * width. The overview's chart was drawn at a hard 520px and overflowed every
 * phone it was opened on -- the panel scrolled sideways and the last hour was
 * off-screen, which is exactly the part an owner looks for.
 *
 * `markIndex` puts a dot on one bucket. It is the only point in the data the
 * line cannot say by itself: which hour was the busy one.
 *
 * The padding is not decoration. A stroke drawn at the very edge of the
 * viewBox is clipped in half by it, so the first and last points sit inside a
 * hairline instead of being shaved.
 */
export function Sparkline({
  data,
  width = 120,
  height = 34,
  className,
  markIndex,
}: {
  data: number[];
  width?: number;
  height?: number;
  /** Fluid sizing, e.g. `h-[120px] w-full`. Omit to keep the pixel size. */
  className?: string;
  /** Index of the bucket to dot -- the peak, when the chart names one. */
  markIndex?: number;
}) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const y = (d: number) => height - ((d - min) / (max - min || 1)) * height;
  const pts = data.map((d, i) => `${i * step},${y(d)}`).join(' ');
  const mark = markIndex !== undefined && data[markIndex] !== undefined ? markIndex : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Revenue by hour"
      className={className}
    >
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {mark !== null ? (
        <circle data-peak="true" cx={mark * step} cy={y(data[mark])} r="3" fill="currentColor" />
      ) : null}
    </svg>
  );
}

export type PillTone = 'sage' | 'alert' | 'blue' | 'sand' | 'ink' | 'outline';

/**
 * A status pill.
 *
 * These live here rather than with the owner kit because the kitchen board, the
 * counter and the order lists all use them, and the guest's order page uses the
 * same two words for the same two states. The owner palette supplies the
 * values: green for paid or ready, a muted red for money still owed, ink for
 * something new, hairline for something finished.
 */
export function Pill({ children, tone = 'outline' }: { children: React.ReactNode; tone?: PillTone }) {
  const tones: Record<PillTone, string> = {
    sage: 'bg-accent-soft text-[var(--p-accent)] ring-[var(--p-accent)]/20',
    alert: 'bg-[var(--alert)]/8 text-[var(--alert)] ring-[var(--alert)]/20',
    blue: 'bg-accent-soft text-[var(--p-accent)] ring-[var(--p-accent)]/15',
    sand: 'bg-paper-deep text-gink-64 ring-hair',
    ink: 'bg-gink text-onink ring-transparent',
    outline: 'bg-transparent text-gink-46 ring-hair-strong',
  };
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.02em] whitespace-nowrap ring-1 ring-inset',
        tones[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}

export function PaymentPill({ state }: { state: 'paid' | 'pending' | 'failed' }) {
  if (state === 'paid') return <Pill tone="sage">Paid online</Pill>;
  if (state === 'pending') return <Pill tone="alert">Counter due</Pill>;
  return <Pill tone="alert">Payment failed</Pill>;
}

export function PrepPill({ state }: { state: 'new' | 'preparing' | 'ready' | 'served' }) {
  const map: Record<string, { tone: PillTone; label: string }> = {
    new: { tone: 'ink', label: 'New' },
    preparing: { tone: 'blue', label: 'Preparing' },
    ready: { tone: 'sage', label: 'Ready' },
    served: { tone: 'outline', label: 'Served' },
  };
  const m = map[state];
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

export function Avatar({ initials }: { initials: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gink text-[11px] font-semibold text-onink">
      {initials}
    </span>
  );
}
