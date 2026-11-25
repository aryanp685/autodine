'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

/**
 * The review invitation a guest sees once their order is PAID.
 *
 * THE RULES THIS COMPONENT EXISTS TO KEEP
 *
 * 1. Fairness. Every guest who paid gets the same invitation and the same
 *    destination. Nothing here reads the order total or any other sentiment
 *    signal, and the Google button opens for a 1-star and a 5-star alike.
 *    Google Business Profile guidance asks for exactly this: invite everyone.
 * 2. Honesty about the one thing we cannot do. Google's review form does not
 *    accept a pre-filled star value, so whatever the guest taps here is
 *    re-chosen on Google's own form. The sheet says so in one line instead
 *    of letting the tap imply a transfer that will not happen.
 * 3. A tap here is not thrown away. The stars and the optional note are
 *    submitted to the restaurant first (submit_order_review, authenticated
 *    by the guest token this screen already holds); the Google link is then
 *    still offered. Submitting and going to Google are independent actions:
 *    neither blocks the other, and a failed submit never blocks the exit.
 *
 * Why the sheet only appears when the restaurant has set a destination
 * (`reviewUrl`): a generic "find us on Google" link would send the guest
 * searching for the restaurant, which is the failure mode the product
 * explicitly rules out. No destination, no invitation.
 *
 * The sheet opens itself once per order. Dismissing it stores the order id in
 * localStorage so a status poll -- which re-renders this screen while the
 * kitchen works -- does not re-open it on every refresh.
 */

const STORAGE_PREFIX = 'autodine-review-invite-done:';

function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.96H1.27v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.27a12 12 0 0 0 0 10.76l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

const STAR_LABELS = ['Terrible', 'Poor', 'Okay', 'Good', 'Great'] as const;

const NOTE_LIMIT = 500;

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'submitted' }
  | { phase: 'error'; message: string };

export function GoogleReviewInvite({
  orderId,
  restaurantName,
  reviewUrl,
  guestToken,
}: {
  orderId: string;
  restaurantName: string;
  reviewUrl: string;
  guestToken: string;
}) {
  const reduce = useReducedMotion();
  const storageKey = `${STORAGE_PREFIX}${orderId}`;
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState('');
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let done = false;
    try {
      done = window.localStorage.getItem(storageKey) === '1';
    } catch {
      // Private modes reject storage. Showing the sheet again on the next
      // poll is the polite failure; blocking the paid guest is not.
    }
    if (!done) setOpen(true);
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function dismiss() {
    setOpen(false);
    try {
      window.localStorage.setItem(storageKey, '1');
    } catch {
      // Same private-mode trade: an unremembered dismissal is acceptable.
    }
  }

  async function handleSubmit() {
    if (stars < 1 || submit.phase === 'submitting' || submit.phase === 'submitted') return;
    setSubmit({ phase: 'submitting' });
    try {
      const response = await fetch('/menu/orders/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, token: guestToken, rating: stars, note }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setSubmit({ phase: 'error', message: payload?.error ?? 'Could not save your review. Please try again.' });
        return;
      }
      setSubmit({ phase: 'submitted' });
    } catch {
      // The network failed, not the guest's intent. Keep the sheet in its
      // error state so a retry is one tap away; Google remains available.
      setSubmit({ phase: 'error', message: 'Could not save your review. Please try again.' });
    }
  }

  const starWord = stars > 0 ? STAR_LABELS[stars - 1] : null;
  const done = submit.phase === 'submitted';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button
            type="button"
            aria-label="Dismiss review invitation"
            className="absolute inset-0 bg-[rgba(18,23,21,0.55)] cursor-default"
            onClick={dismiss}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-invite-title"
            className="relative m-3 w-full max-w-md rounded-2xl border border-hair-strong bg-card p-6 shadow-xl sm:m-0"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <button
              ref={closeRef}
              type="button"
              onClick={dismiss}
              aria-label="Close"
              className="absolute right-3 top-3 grid size-11 place-items-center rounded-full text-muted transition-colors hover:bg-paper-deep hover:text-gink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]"
            >
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>

            <AnimatePresence mode="wait" initial={false}>
              {done ? (
                <motion.div
                  key="done"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                  className="flex flex-col items-center py-2 text-center"
                >
                  <motion.svg
                    viewBox="0 0 24 24"
                    className="size-14 text-gink"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <motion.circle cx="12" cy="12" r="10" className="text-[var(--p-border)]" strokeWidth={1.4} />
                    <motion.path
                      d="M7 12.5l3.2 3.2L17 9"
                      initial={reduce ? { opacity: 0 } : { pathLength: 0 }}
                      animate={reduce ? { opacity: 1 } : { pathLength: 1 }}
                      transition={{ duration: 0.3, delay: 0.12, ease: 'easeOut' }}
                    />
                  </motion.svg>
                  <h2 id="review-invite-title" className="g-display mt-3 text-xl">
                    Thank you
                  </h2>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted">
                    Your rating was sent to {restaurantName}.
                  </p>
                  <a
                    href={reviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={dismiss}
                    className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-gink px-4 py-2.5 text-[14px] font-semibold text-paper transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]"
                  >
                    <GoogleG className="size-4" />
                    Also post it on Google
                  </a>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                >
                  <div className="flex items-center gap-2">
                    <GoogleG className="size-5" />
                    <span className="text-[12px] font-semibold uppercase tracking-wider text-muted">
                      Review on Google
                    </span>
                  </div>

                  <h2 id="review-invite-title" className="g-display mt-3 text-xl">
                    Thanks for paying — how was it?
                  </h2>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                    Your visit to <span className="font-medium text-gink">{restaurantName}</span> is
                    settled. Tell the team how it went.
                  </p>

                  <div className="mt-5 flex justify-center gap-1.5" role="group" aria-label="Choose how you would rate your visit">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <motion.button
                        key={value}
                        type="button"
                        aria-pressed={stars >= value}
                        aria-label={`${value} star${value > 1 ? 's' : ''}`}
                        onClick={() => setStars(value)}
                        whileTap={reduce ? undefined : { scale: 0.85 }}
                        whileHover={reduce ? undefined : { scale: 1.12 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                        className="grid size-11 place-items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]"
                      >
                        <motion.svg
                          viewBox="0 0 24 24"
                          className={`size-8 transition-colors ${stars >= value ? 'text-amber-400' : 'text-[var(--p-border)]'}`}
                          fill="currentColor"
                          aria-hidden="true"
                          animate={reduce || stars !== value ? undefined : { scale: [1.35, 1], rotate: [12, 0] }}
                          transition={{ duration: 0.28, ease: 'easeOut' }}
                        >
                          <path d="M12 2.6l2.9 5.88 6.5.95-4.7 4.58 1.1 6.47L12 17.42l-5.8 3.06 1.1-6.47-4.7-4.58 6.5-.95L12 2.6z" />
                        </motion.svg>
                      </motion.button>
                    ))}
                  </div>
                  <p className="mt-1.5 min-h-5 text-center text-[13px] font-medium text-muted" aria-live="polite">
                    {starWord ?? 'Tap a star to begin.'}
                  </p>

                  <label className="mt-3 block">
                    <span className="text-[13px] font-medium text-muted">
                      Anything more? <span className="text-[12px] font-normal">(optional)</span>
                    </span>
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value.slice(0, NOTE_LIMIT))}
                      maxLength={NOTE_LIMIT}
                      rows={3}
                      placeholder="What did you enjoy, or what should we fix?"
                      className="mt-1.5 w-full resize-none rounded-xl border border-hair-strong bg-paper px-3 py-2.5 text-[14px] leading-relaxed text-gink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]"
                    />
                    <span className="tnum mt-1 block text-right text-[11px] text-muted" aria-hidden="true">
                      {note.length}/{NOTE_LIMIT}
                    </span>
                  </label>

                  {submit.phase === 'error' && (
                    <p role="alert" className="mt-1 text-[13px] font-medium text-red-700">
                      {submit.message}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={stars < 1 || submit.phase === 'submitting'}
                    className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-gink px-4 py-2.5 text-[14px] font-semibold text-paper transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submit.phase === 'submitting' ? (
                      <>
                        <svg viewBox="0 0 24 24" className="size-4 animate-spin motion-reduce:animate-none" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
                          <path d="M12 3a9 9 0 1 1-9 9" />
                        </svg>
                        Sending…
                      </>
                    ) : (
                      'Send review'
                    )}
                  </button>

                  <a
                    href={reviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={dismiss}
                    className="mt-2.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-hair-strong bg-paper px-4 py-2.5 text-[14px] font-semibold text-gink transition-colors hover:bg-paper-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]"
                  >
                    <GoogleG className="size-4" />
                    Skip — continue to Google
                  </a>

                  <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
                    Your rating goes to {restaurantName}. Google asks you to choose your stars again
                    on their page — every guest gets this invitation, whatever the visit was like.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
