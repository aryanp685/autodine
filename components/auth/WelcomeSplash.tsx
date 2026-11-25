'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The welcome after a successful signup: "Setting your table…" while the
 * workspace is being handed over, then the lifted cloche and the inbox step.
 *
 * It is an overlay, never a page: the confirmation-pending content is already
 * in the DOM underneath, so a visitor with JavaScript off or reduced motion
 * simply sees the page. The gate owns `open`, so the URL param and the replay
 * button both drive it.
 */

const SETTING_MS = 2400;
const SETTLE_MS = 2200;

const stepLabels = ['Details entered', 'Confirmation link', 'Inbox step'];

export function WelcomeSplash({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<'setting' | 'ready'>('setting');
  const dismissRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setPhase('setting');
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    setPhase('setting');
    const timer = window.setTimeout(() => setPhase('ready'), reduceMotion ? 500 : SETTING_MS);
    return () => window.clearTimeout(timer);
  }, [open, reduceMotion]);

  useEffect(() => {
    if (!open || phase !== 'ready') return;
    const timer = window.setTimeout(close, reduceMotion ? 2400 : SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [open, phase, reduceMotion, close]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    dismissRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const eased = reduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 90, damping: 16 };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="welcome-splash"
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-title"
          data-signup-splash
          className="fixed inset-0 z-[80] overflow-y-auto bg-[var(--p-accent,#183d32)] text-white"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <span className="absolute -left-24 -top-24 size-[420px] rounded-full border border-white/10" />
            <span className="absolute -left-10 -top-10 size-[260px] rounded-full border border-[var(--auth-accent-bright,#f08a55)]/20" />
            <span className="absolute -bottom-32 -right-24 size-[460px] rounded-full border border-white/10" />
            <span className="absolute bottom-10 right-10 size-[280px] rounded-full border border-[var(--auth-accent-bright,#f08a55)]/15" />
            <svg className="absolute bottom-0 left-0 h-40 w-40 text-white/12" viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M10 96c22-4 38-18 46-40 5-14 8-30 7-46" />
              <path d="M31 72c-8-3-15-10-17-19 9-1 17 2 23 8" />
              <path d="M47 50c-7-5-11-13-10-22 9 2 15 7 19 14" />
              <path d="M56 26c-4-6-4-14 0-20 6 5 9 11 8 18" />
            </svg>
          </div>

          <div className="relative mx-auto flex min-h-dvh w-full max-w-[560px] flex-col items-center justify-center px-6 py-12 text-center">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[var(--auth-accent-bright,#f08a55)]">
              Autodine · Swagat
            </p>

            <div className="relative mt-8 h-[196px] w-[272px]" aria-hidden="true">
              <motion.span
                className="absolute right-3 top-1 block size-11 rounded-full bg-[var(--auth-accent,#ea6a2a)]"
                animate={reduceMotion ? undefined : { scale: [1, 1.06, 1], opacity: [0.9, 1, 0.9] }}
                transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
              />
              <svg viewBox="0 0 272 196" className="relative h-full w-full" fill="none" strokeLinecap="round">
                <ellipse cx="136" cy="168" rx="96" ry="9" fill="var(--auth-accent,#ea6a2a)" opacity="0.16" />
                <path d="M40 162h192" stroke="white" strokeOpacity="0.55" strokeWidth="2.4" />
                <motion.g
                  animate={phase === 'ready' || reduceMotion ? { y: -30 } : { y: 0 }}
                  transition={eased}
                >
                  <path d="M80 148a56 56 0 0 1 112 0" stroke="white" strokeWidth="3" />
                  <path d="M80 148h112" stroke="var(--auth-accent-bright,#f08a55)" strokeWidth="3" />
                  <circle cx="136" cy="82" r="4.2" fill="var(--auth-accent,#ea6a2a)" />
                  <path d="M136 86v8" stroke="white" strokeWidth="2.6" />
                  <path d="M104 148a32 32 0 0 1 64 0" stroke="white" strokeOpacity="0.35" strokeWidth="1.6" />
                </motion.g>
                <motion.g
                  animate={phase === 'ready' || reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                  transition={eased}
                >
                  <ellipse cx="136" cy="152" rx="52" ry="7" stroke="white" strokeWidth="2" />
                  <path d="M64 150v10M208 150v10" stroke="white" strokeWidth="2" />
                  <path d="M56 160v-12M52 148v5M60 148v5" stroke="white" strokeWidth="1.6" />
                  <motion.path
                    d="M118 62c-4-6 4-9 0-15M136 56c-4-6 4-9 0-15M154 62c-4-6 4-9 0-15"
                    stroke="white"
                    strokeOpacity="0.7"
                    strokeWidth="2"
                    animate={reduceMotion ? undefined : { y: [0, -4, 0], opacity: [0.4, 0.8, 0.4] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </motion.g>
              </svg>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {phase === 'ready' ? (
                <motion.div
                  key="ready"
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-2"
                >
                  <h2 id="welcome-title" className="font-display text-[clamp(1.9rem,7vw,2.6rem)] leading-[1.05] tracking-[-0.03em]">
                    Your table is set.
                  </h2>
                  <p className="mx-auto mt-3 max-w-[36ch] text-[14px] leading-relaxed text-white/75">
                    The next step is in your inbox — open the confirmation link to step in. If it has not arrived, resend it below.
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="setting"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.3 }}
                  className="mt-2"
                >
                  <h2 id="welcome-title" className="font-display text-[clamp(1.9rem,7vw,2.6rem)] leading-[1.05] tracking-[-0.03em]">
                    Setting your table…
                  </h2>
                  <p className="mx-auto mt-3 max-w-[34ch] text-[14px] leading-relaxed text-white/75">
                    Opening the next step: your inbox and the confirmation link.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-8 w-full max-w-[300px]">
              <div className="h-[3px] overflow-hidden rounded-full bg-white/15">
                <motion.span
                  className="block h-full rounded-full bg-[var(--auth-accent,#ea6a2a)]"
                  initial={{ width: '12%' }}
                  animate={{ width: phase === 'ready' ? '100%' : '78%' }}
                  transition={{ duration: reduceMotion ? 0 : phase === 'ready' ? 0.4 : 2.3, ease: 'easeOut' }}
                />
              </div>
              <ul className="mt-5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-white/55">
                {stepLabels.map((label, index) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <span
                      className={`size-1.5 rounded-full ${
                        phase === 'ready' || index === 0 ? 'bg-[var(--auth-accent-bright,#f08a55)]' : 'bg-white/25'
                      }`}
                    />
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            <motion.button
              ref={dismissRef}
              type="button"
              onClick={close}
              className="mt-9 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--auth-accent,#ea6a2a)] px-7 text-[13.5px] font-semibold text-[var(--auth-heading,#2b2015)] shadow-[0_16px_34px_-20px_rgba(0,0,0,0.6)] transition-[background-color,transform] duration-300 hover:-translate-y-px hover:bg-[var(--auth-accent-strong,#f17b3e)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              animate={reduceMotion ? undefined : { opacity: phase === 'ready' ? 1 : 0.72 }}
              transition={{ duration: 0.2 }}
            >
              {phase === 'ready' ? 'Continue to your inbox' : 'Skip the welcome'}
            </motion.button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
