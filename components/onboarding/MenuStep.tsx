'use client';

import { StepShell } from './StepShell';
import type { OnboardingStepProps } from './types';

export function MenuStep(props: OnboardingStepProps) {
  return <StepShell {...props} />;
}