'use client';

import { StepShell } from './StepShell';
import type { OnboardingStepProps } from './types';

export function WelcomeStep(props: OnboardingStepProps) {
  return <StepShell {...props} />;
}