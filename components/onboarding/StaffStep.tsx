'use client';

import { StepShell } from './StepShell';
import type { OnboardingStepProps } from './types';

export function StaffStep(props: OnboardingStepProps) {
  return <StepShell {...props} />;
}