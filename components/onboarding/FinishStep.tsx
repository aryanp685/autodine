'use client';

import { StepShell } from './StepShell';
import type { OnboardingStepProps } from './types';

export function FinishStep(props: OnboardingStepProps) {
  return <StepShell {...props} />;
}