/**
 * Shared contract for every onboarding step placeholder.
 *
 * Each step is a self-contained shell: it draws a title and a Continue button
 * that advances the wizard, and nothing else. There is no form and no write —
 * this is the skeleton the real screens are dropped into. Keeping the props in
 * one place means the wizard can render any step the same way regardless of
 * which one it is.
 */

export type OnboardingStepProps = {
  /** The step's own title, echoed into the heading. */
  title: string;
  /**
   * Advance to the next step (or, on the last step, leave the wizard). The
   * caller decides what "advance" means so the step itself never reads the URL.
   */
  onContinue: () => void;
  /** When true, the step may also be passed over; a Skip button is offered. */
  canSkip: boolean;
  /** Optional skip handler. Supplied whenever `canSkip` is true. */
  onSkip?: () => void;
  /** True on the last step, where "continue" leaves the wizard. */
  isLast: boolean;
};