'use client';

/**
 * The onboarding wizard shell.
 *
 * It owns exactly one piece of state — which step is showing — and that lives
 * in the `?step=` URL rather than in React, so a reload, a back-button press and
 * a shared link all land on the same step. The server page validates the
 * requested step against the sequence before this renders; here we only move
 * between steps and draw the progress rail.
 *
 * The six step screens are lazy-loaded: each is a separate chunk pulled in only
 * when it is the active step, so a new owner downloads the wizard, not six
 * screens at once. They are placeholders — none of them writes anything.
 */

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import type { OnboardingStep } from '@/lib/onboarding';
import type { OnboardingStepProps } from './types';

/* Each step is its own lazily-fetched chunk, keyed by the config's component
   name. A step the config does not name is rendered as a plain message rather
   than crashing the wizard. */
const WelcomeStep = dynamic(() => import('./WelcomeStep').then((m) => m.WelcomeStep));
const OutletStep = dynamic(() => import('./OutletStep').then((m) => m.OutletStep));
const MenuStep = dynamic(() => import('./MenuStep').then((m) => m.MenuStep));
const TablesStep = dynamic(() => import('./TablesStep').then((m) => m.TablesStep));
const StaffStep = dynamic(() => import('./StaffStep').then((m) => m.StaffStep));
const FinishStep = dynamic(() => import('./FinishStep').then((m) => m.FinishStep));

const STEP_COMPONENTS: Record<string, React.ComponentType<OnboardingStepProps>> = {
  WelcomeStep,
  OutletStep,
  MenuStep,
  TablesStep,
  StaffStep,
  FinishStep,
};

export type OnboardingWizardProps = {
  steps: OnboardingStep[];
  /** Zero-based index of the step to show, already validated by the server. */
  currentIndex: number;
};

export function OnboardingWizard({ steps, currentIndex }: OnboardingWizardProps) {
  const router = useRouter();
  const last = steps.length - 1;

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, last));
      const next = steps[clamped];
      // Continue / Skip move within the wizard; finishing leaves it for the
      // dashboard. Using ?step= keeps the URL the single source of truth.
      if (clamped > last) {
        router.push('/dashboard');
        return;
      }
      router.push(`/onboarding?step=${encodeURIComponent(next.id)}`);
    },
    [last, router, steps],
  );

  const current = steps[currentIndex];

  const stepProps: OnboardingStepProps = {
    title: current.title,
    onContinue: () => {
      if (currentIndex === last) {
        router.push('/dashboard');
        return;
      }
      goTo(currentIndex + 1);
    },
    canSkip: current.canSkip,
    onSkip: current.canSkip ? () => goTo(currentIndex + 1) : undefined,
    isLast: currentIndex === last,
  };

  const ActiveStep = STEP_COMPONENTS[current.component];

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold text-gink-90">Set up your restaurant</h1>
        <p className="mt-1 text-[13px] text-gink-64">
          A few quick steps and you are ready to serve.
        </p>
      </header>

      <ol className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]">
        {steps.map((step, index) => {
          const state =
            index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming';
          return (
            <li key={step.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={
                  state === 'complete'
                    ? 'grid size-5 place-items-center rounded-full bg-gink-90 text-white'
                    : state === 'current'
                      ? 'grid size-5 place-items-center rounded-full bg-[var(--p-accent)] text-white'
                      : 'grid size-5 place-items-center rounded-full border border-black/10 text-gink-46'
                }
              >
                {state === 'complete' ? '\u2713' : index + 1}
              </span>
              <span
                className={
                  state === 'upcoming'
                    ? 'text-gink-46'
                    : state === 'current'
                      ? 'font-medium text-gink-90'
                      : 'text-gink-64'
                }
                aria-current={state === 'current' ? 'step' : undefined}
              >
                {step.title}
              </span>
              {index < last ? <span className="text-gink-46">&rarr;</span> : null}
            </li>
          );
        })}
      </ol>

      {ActiveStep ? (
        <ActiveStep {...stepProps} />
      ) : (
        <section className="rounded-2xl border border-black/5 bg-white p-6 text-[13px] text-gink-64">
          This step has no screen yet.
        </section>
      )}
    </div>
  );
}