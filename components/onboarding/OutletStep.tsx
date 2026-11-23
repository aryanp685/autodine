'use client';

import { StepShell } from './StepShell';
import type { OnboardingStepProps } from './types';

export function OutletStep(props: OnboardingStepProps) {
  return <StepShell {...props} />;
}