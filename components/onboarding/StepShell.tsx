'use client';

/**
 * The one shell every onboarding step draws.
 *
 * A step is deliberately thin: a title, one or two sentences, and the
 * navigation buttons. All six steps render this, so a placeholder and a future
 * real screen look the same on the way in. There is no form here and nothing is
 * written — the Continue/Skip buttons call back into the wizard, which owns the
 * `?step=` URL.
 */

import { btn } from '@/components/owner/chrome';
import type { OnboardingStepProps } from './types';

export function StepShell({ title, onContinue, canSkip, onSkip, isLast }: OnboardingStepProps) {
  return (
    <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm sm:p-8">
      <p className="m-0 text-[11px] font-medium uppercase tracking-[0.08em] text-gink-46">
        {isLast ? 'Final step' : 'Setup'}
      </p>
      <h2 className="mt-1.5 text-[20px] font-semibold leading-tight text-gink-90">{title}</h2>
      <p className="mt-2 text-[13px] leading-[1.6] text-gink-64">
        This is a placeholder step. The real {title.toLowerCase()} screen will be dropped in here;
        for now it advances the wizard.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button type="button" className={btn('primary', 'md')} onClick={onContinue}>
          {isLast ? 'Finish' : 'Continue'}
        </button>
        {canSkip && onSkip ? (
          <button type="button" className={btn('quiet', 'md')} onClick={onSkip}>
            Skip
          </button>
        ) : null}
      </div>
    </section>
  );
}