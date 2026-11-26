'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * The guest menu, played inside the hero phone.
 *
 * It is a small, self-contained illustration of the guest's half of the
 * product: filter the menu, add a dish, watch the order total. The autoplay is
 * the page demonstrating itself; it pauses the moment a pointer or keyboard
 * lands on it and stops for good once the visitor takes over, so the demo
 * never fights the person using it. Reduced motion gets the same screen with
 * no autoplay, and every dish here is the sample menu's own dish and price.
 */

type Category = 'all' | 'starters' | 'mains';

const TABS: { id: Category; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'starters', label: 'Starters' },
  { id: 'mains', label: 'Mains' },
];

const DISHES = [
  {
    id: 'paneer-tikka',
    name: 'Paneer Tikka',
    desc: 'Charred cottage cheese, ajwain marinade',
    price: 349,
    img: '/img/dishes/paneer-tikka.jpg',
    category: 'starters' as const,
  },
  {
    id: 'hara-bhara',
    name: 'Hara Bhara Kebab',
    desc: 'Spinach, green pea and cashew patty',
    price: 299,
    img: '/img/dishes/hara-bhara-kebab.jpg',
    category: 'starters' as const,
  },
  {
    id: 'butter-chicken',
    name: 'Butter Chicken',
    desc: 'Tomato, cashew and butter gravy',
    price: 469,
    img: '/img/dishes/butter-chicken.jpg',
    category: 'mains' as const,
  },
];

type Step =
  | { kind: 'reset' }
  | { kind: 'wait' }
  | { kind: 'tab'; id: Category }
  | { kind: 'toggle'; id: string };

/* Nine seconds, one second per step: reset, add a starter, narrow to starters,
   add a second, widen back out, add a main, then hold the finished order while
   the ticket sits readable on screen. */
const SCRIPT: Step[] = [
  { kind: 'reset' },
  { kind: 'wait' },
  { kind: 'toggle', id: 'paneer-tikka' },
  { kind: 'tab', id: 'starters' },
  { kind: 'toggle', id: 'hara-bhara' },
  { kind: 'tab', id: 'all' },
  { kind: 'toggle', id: 'butter-chicken' },
  { kind: 'wait' },
  { kind: 'wait' },
];
const STEP_MS = 1000;

function toggleItem(cart: Record<string, number>, id: string) {
  const next = { ...cart };
  if (next[id]) delete next[id];
  else next[id] = 1;
  return next;
}

export function HeroMenuDemo() {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<Category>('all');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [auto, setAuto] = useState(true);
  const [manual, setManual] = useState(false);
  const [step, setStep] = useState(0);

  const running = auto && !hovered && !focused && !hidden && !reduce;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % SCRIPT.length), STEP_MS);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!auto || reduce) return;
    const action = SCRIPT[step];
    if (action.kind === 'tab') setTab(action.id);
    else if (action.kind === 'toggle') setCart((c) => toggleItem(c, action.id));
    else if (action.kind === 'reset') {
      setTab('all');
      setCart({});
    }
  }, [step, auto, reduce]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const takeOver = () => {
    setAuto(false);
    setManual(true);
  };

  const visible = tab === 'all' ? DISHES : DISHES.filter((dish) => dish.category === tab);
  const count = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const total = DISHES.reduce((sum, dish) => sum + (cart[dish.id] ?? 0) * dish.price, 0);

  return (
    <div
      className="relative mx-auto w-full"
      data-menu-demo
      role="group"
      aria-label="Interactive demo of the guest menu"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="relative z-10 rounded-[34px] border border-white/80 bg-white/90 p-2 shadow-[0_36px_70px_-32px_rgba(31,77,58,0.35)] ring-1 ring-forest/[0.04] backdrop-blur">
        <div className="overflow-hidden rounded-[27px] bg-ink ring-1 ring-gink-07">
          <div className="flex items-center justify-between px-4 pt-2.5 text-[10px] text-mute-dim">
            <span>9:41</span>
            <span className="h-1.5 w-16 rounded-full bg-gink-12" />
            <span>5G</span>
          </div>

          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <div>
              <p className="text-[9px] uppercase tracking-[0.18em] text-forest">Table 05</p>
              <p className="mt-1 text-[15px] font-medium tracking-tight">The Urban Table</p>
              <p className="text-[10px] text-mute-dim">North Indian · dine-in</p>
            </div>
            <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-ink-soft text-mute">✕</span>
          </div>

          <div className="flex gap-1 overflow-hidden px-4 pb-3 text-[9px]" role="group" aria-label="Filter the demo menu">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={tab === entry.id}
                onClick={() => {
                  takeOver();
                  setTab(entry.id);
                }}
                className={
                  tab === entry.id
                    ? 'whitespace-nowrap rounded-full bg-forest px-2 py-1 font-medium text-white transition-colors duration-200 motion-reduce:transition-none'
                    : 'whitespace-nowrap rounded-full bg-ink-soft px-2 py-1 text-mute transition-colors duration-200 hover:text-cream motion-reduce:transition-none'
                }
              >
                {entry.label}
              </button>
            ))}
          </div>

          <ul className="space-y-1.5 px-3">
            {visible.map((dish) => {
              const inCart = Boolean(cart[dish.id]);
              return (
                <li
                  key={dish.id}
                  data-menu-dish
                  className={
                    inCart
                      ? 'flex items-center gap-2 rounded-xl border border-forest/25 bg-forest-soft p-1.5 transition-colors duration-200 motion-reduce:transition-none'
                      : 'flex items-center gap-2 rounded-xl border border-hair bg-white p-1.5 transition-colors duration-200 motion-reduce:transition-none'
                  }
                >
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-lg">
                    <Image src={dish.img} alt="" fill sizes="48px" className="object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-medium">{dish.name}</p>
                    <p className="truncate text-[9.5px] leading-snug text-mute-dim">{dish.desc}</p>
                    <p className="mt-0.5 text-[11.5px] font-medium text-forest">
                      ₹<span className="tnum">{dish.price}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      takeOver();
                      setCart((c) => toggleItem(c, dish.id));
                    }}
                    aria-pressed={inCart}
                    aria-label={
                      inCart ? `Remove ${dish.name} from the sample order` : `Add ${dish.name} to the sample order`
                    }
                    className={
                      inCart
                        ? 'relative grid size-7 shrink-0 place-items-center rounded-full bg-brass text-[12px] text-ink after:absolute after:-inset-2 after:content-[""] transition-colors duration-200 motion-reduce:transition-none'
                        : 'relative grid size-7 shrink-0 place-items-center rounded-full bg-forest text-[13px] text-white after:absolute after:-inset-2 after:content-[""] transition-colors duration-200 hover:bg-forest-strong motion-reduce:transition-none'
                    }
                  >
                    {inCart ? '✓' : '+'}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="relative h-[52px] px-3 pb-3">
            <p
              aria-hidden="true"
              className={
                count === 0
                  ? 'pt-2 text-[9.5px] text-mute-dim opacity-100 transition-opacity duration-200 motion-reduce:transition-none'
                  : 'pt-2 text-[9.5px] text-mute-dim opacity-0 transition-opacity duration-200 motion-reduce:transition-none'
              }
            >
              Sample order · tap a dish to begin
            </p>
            <div
              className={
                count > 0
                  ? 'absolute inset-x-3 bottom-3 flex h-10 items-center justify-between rounded-xl bg-forest px-3 text-white opacity-100 transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none'
                  : 'pointer-events-none absolute inset-x-3 bottom-3 flex h-10 translate-y-1.5 items-center justify-between rounded-xl bg-forest px-3 text-white opacity-0 transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none'
              }
            >
              <span className="text-[10.5px] font-medium">
                {count} {count === 1 ? 'dish' : 'dishes'}
              </span>
              <span className="text-[11.5px] font-medium tnum">₹{total.toLocaleString('en-IN')}</span>
              <span aria-hidden="true" className="rounded-full bg-white/15 px-2 py-0.5 text-[9px] tracking-[0.08em] uppercase">
                Review
              </span>
            </div>
            <p aria-live={manual ? 'polite' : 'off'} className="sr-only">
              {count === 0
                ? 'No dishes in the sample order'
                : `${count} ${count === 1 ? 'dish' : 'dishes'} in the sample order`}
            </p>
          </div>
        </div>
      </div>

      {/* The table card, because the whole product starts with one. */}
      <div aria-hidden="true" className="absolute -bottom-5 -left-9 hidden rounded-2xl border border-white/80 bg-white/90 p-3 shadow-[0_18px_36px_-24px_rgba(31,77,58,0.4)] backdrop-blur sm:block">
        <div className="grid h-14 w-14 place-items-center rounded-lg bg-ink ring-1 ring-gink-07">
          <div className="grid grid-cols-5 gap-0.5">
            {Array.from({ length: 25 }).map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 ${i % 3 === 0 || i % 7 === 0 ? 'bg-cream' : 'bg-transparent'}`} />
            ))}
          </div>
        </div>
        <p className="mt-2 text-center text-[9px] uppercase tracking-[0.14em] text-mute">Table 05</p>
      </div>
    </div>
  );
}
